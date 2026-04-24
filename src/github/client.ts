import { Octokit } from "@octokit/rest";
import { config } from "../config.js";

const { token, owner, repo, baseBranch, targetFile } = config.github;

const octokit = new Octokit({ auth: token });

/**
 * Read the current contents of the target file from the base branch.
 * Returns the decoded text plus the blob sha (needed later to update the file).
 */
export async function getFile(): Promise<{ content: string; sha: string }> {
  const { data } = await octokit.repos.getContent({
    owner,
    repo,
    path: targetFile,
    ref: baseBranch,
  });

  // getContent can return an array (for directories) or other shapes.
  // For a single file we expect an object with a base64-encoded `content` field.
  if (Array.isArray(data) || data.type !== "file") {
    throw new Error(`Expected ${targetFile} to be a file, got ${JSON.stringify(data)}`);
  }

  return {
    content: Buffer.from(data.content, "base64").toString("utf-8"),
    sha: data.sha,
  };
}

/**
 * End-to-end: branch off main, commit the updated file on the new branch,
 * open a PR back to main. Returns the PR URL.
 */
export async function openFeedbackPR(params: {
  newContent: string;
  fileSha: string;
  branch: string;
  commitMessage: string;
  prTitle: string;
  prBody: string;
}): Promise<string> {
  const baseSha = await getBaseBranchSha();
  await createBranch(params.branch, baseSha);
  await commitFile({
    branch: params.branch,
    newContent: params.newContent,
    message: params.commitMessage,
    fileSha: params.fileSha,
  });
  const prUrl = await createPullRequest({
    branch: params.branch,
    title: params.prTitle,
    body: params.prBody,
  });
  return prUrl;
}

// ---------- helpers ----------

async function getBaseBranchSha(): Promise<string> {
  const { data } = await octokit.git.getRef({
    owner,
    repo,
    ref: `heads/${baseBranch}`,
  });
  return data.object.sha;
}

async function createBranch(branch: string, fromSha: string): Promise<void> {
  await octokit.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${branch}`,
    sha: fromSha,
  });
}

async function commitFile(params: {
  branch: string;
  newContent: string;
  message: string;
  fileSha: string;
}): Promise<void> {
  await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: targetFile,
    branch: params.branch,
    message: params.message,
    content: Buffer.from(params.newContent, "utf-8").toString("base64"),
    sha: params.fileSha,
  });
}

async function createPullRequest(params: {
  branch: string;
  title: string;
  body: string;
}): Promise<string> {
  const { data } = await octokit.pulls.create({
    owner,
    repo,
    head: params.branch,
    base: baseBranch,
    title: params.title,
    body: params.body,
  });
  return data.html_url;
}
