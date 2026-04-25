import { createSlackApp } from "./slack/listener.js";
import { startCaddy, stopCaddy, writePreview, previewUrl } from "./caddy/server.js";
import { readIndexHtml } from "./github/client.js";

async function main() {
  // Seed the preview dir with the current main-branch HTML so Caddy has something to serve.
  try {
    const { content } = await readIndexHtml();
    await writePreview(content);
    console.log("[preview] seeded from GitHub main branch");
  } catch (err) {
    console.warn("[preview] could not seed from GitHub (is the repo empty?):", err);
  }

  await startCaddy();
  console.log(`[caddy] serving ${previewUrl()}`);

  const app = createSlackApp();
  await app.start();
  console.log("[slack] socket mode connected — listening for feedback");
}

function shutdown() {
  stopCaddy();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch((err) => {
  console.error(err);
  stopCaddy();
  process.exit(1);
});
