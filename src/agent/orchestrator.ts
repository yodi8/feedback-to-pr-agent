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

  if (decision.edits.length === 0) {
    return { text: `:warning: Agent said "feature" but returned no edits.` };
  }

  const { content, sha } = await readIndexHtml();

  // Apply edits sequentially, validating each is unambiguous against the evolving file.
  let updated = content;
  for (const [i, edit] of decision.edits.entries()) {
    const occurrences = updated.split(edit.oldString).length - 1;
    if (occurrences === 0) {
      return { text: `:warning: Edit ${i + 1} target not found in index.html.` };
    }
    if (occurrences > 1) {
      return { text: `:warning: Edit ${i + 1} target appears ${occurrences} times; need a more specific snippet.` };
    }
    updated = updated.replace(edit.oldString, edit.newString);
  }

  // Write preview first so the URL reflects the change immediately.
  await writePreview(updated);

  const prTitle = decision.prTitle ?? "Apply feedback";
  const prUrl = await commitAndOpenPR({
    newContent: updated,
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
