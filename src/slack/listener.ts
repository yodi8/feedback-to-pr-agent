import pkg from "@slack/bolt";
const { App, LogLevel } = pkg;
import { config } from "../config.js";
import { handleFeedback } from "../agent/orchestrator.js";

export function createSlackApp() {
  const app = new App({
    token: config.slack.botToken,
    appToken: config.slack.appToken,
    signingSecret: config.slack.signingSecret || undefined,
    socketMode: true,
    logLevel: LogLevel.INFO,
  });

  app.message(async ({ message, client, say }) => {
    // Ignore edits, bot messages, thread replies, and anything missing text.
    if (message.subtype || !("text" in message) || !message.text) return;
    if ("thread_ts" in message && message.thread_ts) return;

    // Resolve channel name → skip if not the feedback channel.
    try {
      const info = await client.conversations.info({ channel: message.channel });
      if (info.channel?.name !== config.slack.feedbackChannel) return;
    } catch {
      return; // can't read channel, stay silent
    }

    const thread_ts = message.ts;
    try {
      await say({ text: "On it — reading the repo and thinking…", thread_ts });
      const { text } = await handleFeedback(message.text);
      await say({ text, thread_ts });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[handleFeedback] error:", err);
      await say({ text: `:warning: Something went wrong: \`${msg}\``, thread_ts });
    }
  });

  return app;
}
