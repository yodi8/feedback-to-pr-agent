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

  if (!decision.edit) {
    return { text: `:warning: Agent said "feature" but returned no edit.` };
  }

  const edit = decision.edit;
  const { content, sha } = await readIndexHtml();

  // Verify the edit is surgical and unambiguous before applying.
  const occurrences = content.split(edit.oldString).length - 1;
  if (occurrences === 0) {
    return { text: `:warning: Agent proposed an edit but the target text wasn't found in index.html.` };
  }
  if (occurrences > 1) {
    return { text: `:warning: Agent's edit target appears ${occurrences} times. Need a more specific snippet.` };
  }

  const updated = content.replace(edit.oldString, edit.newString);

  // Update preview first so the URL reflects the change immediately.
  await writePreview(updated);

  const prUrl = await commitAndOpenPR({
    newContent: updated,
    fileSha: sha,
    branch: `feedback/${Date.now()}`,
    commitMessage: edit.prTitle,
    prTitle: edit.prTitle,
    prBody: edit.prBody,
  });

  return {
    text: [
      decision.reply || "Got it — change applied.",
      `*Change:* ${edit.changeSummary}`,
      `*PR:* ${prUrl}`,
      `*Preview:* ${previewUrl()}`,
    ].join("\n"),
  };
}
