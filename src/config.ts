import "dotenv/config";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const config = {
  slack: {
    botToken: required("SLACK_BOT_TOKEN"),
    appToken: required("SLACK_APP_TOKEN"),
    signingSecret: process.env.SLACK_SIGNING_SECRET ?? "",
    feedbackChannel: process.env.SLACK_FEEDBACK_CHANNEL ?? "feedback",
  },
  github: {
    token: required("GITHUB_TOKEN"),
    owner: required("GITHUB_OWNER"),
    repo: required("GITHUB_REPO"),
    baseBranch: process.env.GITHUB_BASE_BRANCH ?? "main",
    targetFile: "index.html",
  },
  llm: {
    apiKey: required("OPENROUTER_API_KEY"),
    model: process.env.OPENROUTER_MODEL ?? "google/gemini-2.5-flash-lite-preview-09-2025",
  },
  caddy: {
    port: Number(process.env.CADDY_PORT ?? 3000),
    previewDir: process.env.PREVIEW_DIR ?? "preview",
  },
};
