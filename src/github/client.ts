import { Octokit } from "@octokit/rest";
import { config } from "../config.js";

const { token, owner, repo, baseBranch, targetFile } = config.github;
const octokit = new Octokit({ auth: token });

/** Read the current index.html from the base branch. */
export async function readIndexHtml(): Promise<{ content: string; sha: string }> {
  const { data } = await octokit.repos.getContent({
    owner,
    repo,
    path: targetFile,
    ref: baseBranch,
  });

  if (Array.isArray(data) || data.type !== "file") {
    throw new Error(`Expected ${targetFile} to be a file.`);
  }

  return {
    content: Buffer.from(data.content, "base64").toString("utf-8"),
    sha: data.sha,
  };
}

/**
 * Branch off main, commit the new file contents, open a PR. Returns the PR URL.
 * Reads top-to-bottom — each step is one Octokit call.
 */
export async function commitAndOpenPR(input: {
  newContent: string;
  fileSha: string;
  branch: string;
  commitMessage: string;
  prTitle: string;
  prBody: string;
}): Promise<string> {
  // 1. Find the commit that `main` currently points to.
  const { data: mainRef } = await octokit.git.getRef({
    owner,
    repo,
    ref: `heads/${baseBranch}`,
  });
  const mainSha = mainRef.object.sha;

  // 2. Create a new branch starting from that commit.
  await octokit.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${input.branch}`,
    sha: mainSha,
  });

  // 3. Commit the updated file on the new branch.
  await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: targetFile,
    branch: input.branch,
    message: input.commitMessage,
    content: Buffer.from(input.newContent, "utf-8").toString("base64"),
    sha: input.fileSha,
  });

  // 4. Open a PR from the new branch back into main.
  const { data: pr } = await octokit.pulls.create({
    owner,
    repo,
    head: input.branch,
    base: baseBranch,
    title: input.prTitle,
    body: input.prBody,
  });

  return pr.html_url;
}
