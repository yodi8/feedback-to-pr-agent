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
    console.log("[slack] message event received:", JSON.stringify(message, null, 2));

    // Ignore edits, bot messages, thread replies, and anything missing text.
    if (message.subtype || !("text" in message) || !message.text) {
      console.log("[slack] skipped: subtype/no-text/bot");
      return;
    }
    if ("thread_ts" in message && message.thread_ts) {
      console.log("[slack] skipped: thread reply");
      return;
    }

    // Resolve channel name → skip if not the feedback channel.
    try {
      const info = await client.conversations.info({ channel: message.channel });
      console.log(`[slack] channel name: ${info.channel?.name} (expecting: ${config.slack.feedbackChannel})`);
      if (info.channel?.name !== config.slack.feedbackChannel) {
        console.log("[slack] skipped: wrong channel");
        return;
      }
    } catch (err) {
      console.error("[slack] conversations.info failed:", err);
      return;
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
