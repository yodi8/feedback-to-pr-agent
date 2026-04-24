import { decide } from "./llm.js";
import { getFile, openFeedbackPR } from "../github/client.js";
import { writePreview, previewUrl } from "../caddy/server.js";

export interface HandleResult {
  text: string;        // message to post in the Slack thread
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

export async function handleFeedback(message: string): Promise<HandleResult> {
  const { content: currentHtml, sha } = await getFile();
  const decision = await decide(message, currentHtml);

  if (decision.classification === "noise" || !decision.updatedHtml) {
    return {
      text: `Thanks for the note! I didn't detect an actionable change here, so I haven't opened a PR. (${decision.reason})`,
    };
  }

  // 1) Update local preview first so the URL immediately reflects the change.
  await writePreview(decision.updatedHtml);

  // 2) Open the PR on GitHub.
  const branch = `feedback/${Date.now()}-${slugify(decision.prTitle ?? decision.reason)}`;
  const prUrl = await openFeedbackPR({
    newContent: decision.updatedHtml,
    fileSha: sha,
    branch,
    commitMessage: decision.prTitle ?? "Apply feedback",
    prTitle: decision.prTitle ?? "Apply feedback",
    prBody: `${decision.prSummary ?? decision.reason}\n\n---\n_Generated automatically from Slack feedback:_\n> ${message}`,
  });

  const summary = decision.changeSummary ?? decision.reason;
  return {
    text: [
      `Got it — understood as: _${decision.reason}_`,
      `*Change:* ${summary}`,
      `*PR:* ${prUrl}`,
      `*Preview:* ${previewUrl()}`,
    ].join("\n"),
  };
}
