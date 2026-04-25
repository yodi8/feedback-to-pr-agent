import { runAgent } from "./agent.js";
import { readIndexHtml, commitAndOpenPR } from "../github/client.js";
import { writePreview, previewUrl } from "../caddy/server.js";

export interface HandleResult {
  text: string;
}

export async function handleFeedback(message: string): Promise<HandleResult> {
  const decision = await runAgent(message);

  if (decision.decision === "noise") {
    return { text: decision.reply || "Thanks for the note — nothing to change here." };
  }

  if (decision.decision === "preview") {
    return {
      text: [
        decision.reply || "Here's the current page:",
        `*Preview:* ${previewUrl()}`,
      ].join("\n"),
    };
  }

  if (!decision.updatedHtml) {
    return { text: `:warning: Agent said "feature" but returned no updated HTML.` };
  }

  const { sha } = await readIndexHtml();

  // Update preview first so the URL reflects the change immediately.
  await writePreview(decision.updatedHtml);

  const prTitle = decision.prTitle ?? "Apply feedback";
  const prUrl = await commitAndOpenPR({
    newContent: decision.updatedHtml,
    fileSha: sha,
    branch: `feedback/${Date.now()}`,
    commitMessage: prTitle,
    prTitle,
    prBody: decision.prBody ?? "Automated change from Slack feedback.",
  });

  return {
    text: [
      decision.reply || decision.changeSummary || "Changes applied.",
      `*PR:* ${prUrl}`,
      `*Preview:* ${previewUrl()}`,
    ].join("\n"),
  };
}
