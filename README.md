# feedback-to-pr-agent

An autonomous Slack agent that watches a `#feedback` channel, classifies each message, and — when the feedback requests a change — rewrites a single-file HTML product page, opens a GitHub Pull Request, and replies in-thread with the PR link and a live local preview URL served by Caddy.

Built as the take-home assignment for the Zid Engineering Internship.

---

## How it works

```
┌─────────────┐   message    ┌──────────────────┐    JSON decision    ┌──────────────────┐
│   Slack     │ ───────────▶ │  Slack listener  │ ──────────────────▶ │      Agent       │
│  #feedback  │              │  (Socket Mode)   │                     │  (PI Agent SDK)  │
└─────────────┘              └──────────────────┘                     └──────────────────┘
      ▲                                                                        │
      │                                                                        │
      │                                                                        ▼
      │                       ┌──────────────────┐    feature          ┌──────────────────┐
      │     reply in thread   │   Orchestrator   │ ◀────────────────── │   LLM decision   │
      └────────────────────── │                  │                     │ feature/preview/ │
                              │                  │                     │      noise       │
                              └──────────────────┘                     └──────────────────┘
                                    │      │
                                    │      │
                       commit + PR  │      │  write file
                                    ▼      ▼
                              ┌──────────┐  ┌──────────┐
                              │  GitHub  │  │  Caddy   │
                              │  (PR)    │  │ (preview)│
                              └──────────┘  └──────────┘
```

The agent handles three kinds of messages:

| Type | Example | Reply |
|---|---|---|
| **feature** | *"Change the price to $129.99"* | Change summary + PR link + preview URL |
| **preview** | *"Can I see the current page?"* | Preview URL only, no PR |
| **noise** | *"Great product page!"* | Short polite acknowledgment, no PR |


---

## Architecture

The agent has two layers of responsibility:

- **The LLM** decides *what* to do — classifying the message and, for features, returning the full updated `index.html`.
- **The orchestrator** does *how* — validates the edit is unambiguous, writes the preview file, opens the PR, and composes the Slack reply. Every side effect lives here, not in the model.

This split keeps the code predictable: the model is never trusted with file writes, git operations, or Slack API calls directly.

### File layout

```
src/
  index.ts              # boot: seed preview → start Caddy → start Slack
  config.ts             # env loading + validation (single source of truth)
  slack/listener.ts     # Bolt Socket Mode app; filters to #feedback
  agent/agent.ts        # PI Agent SDK setup; streams reasoning; returns JSON decision
  agent/orchestrator.ts # executes the decision (edit, commit, PR, preview, reply text)
  github/client.ts      # Octokit wrapper: readIndexHtml + commitAndOpenPR
  caddy/server.ts       # spawns `caddy file-server`, writes preview file
```

Each module has a single job and imports only what it needs. The orchestrator is the only file that glues subsystems together.

### The target repository

The agent does **not** modify its own code — it operates on a separate repo containing a single `index.html` product page (title, image, description, price, Add-to-Cart button, inline styles, no frameworks). See the companion repo referenced by `GITHUB_REPO` in your `.env`.

---

## Tools used

| Tool | Purpose | Why |
|---|---|---|
| **TypeScript + Node.js** | Language / runtime | Strong types for the config + decision shapes; `tsx` runs without a build step. |
| **[@slack/bolt](https://slack.dev/bolt-js)** with Socket Mode | Slack integration | Persistent WebSocket out to Slack — no public URL or tunneling required, fits a local dev setup. |
| **[@mariozechner/pi-agent-core](https://github.com/badlogic/pi-mono) + pi-ai** | LLM layer | Recommended by the assignment. Used for its `Agent` class and streaming event subscription; reasoning is streamed live to the terminal. |
| **[Gemini 2.5 Flash Lite](https://openrouter.ai/models)** via **OpenRouter** | LLM model | Recommended by the assignment. Cheap, fast, good enough for single-file edits. |
| **[@octokit/rest](https://github.com/octokit/octokit.js)** | GitHub REST API | Typed wrapper over the Contents / Git refs / Pulls endpoints. Cleaner than hand-rolled `fetch`. |
| **[Caddy](https://caddyserver.com/)** (`file-server`) | Local preview | One-command static server; spawned as a child process from the agent. |

### Key design choices

- **Full-file rewrite, not patches.** The LLM returns the entire updated `index.html`. At ~25 lines, this is cheaper than fighting the model to produce well-formed structural edits, and it eliminates a whole class of stitching bugs (e.g. duplicated `<style>` tags from naive find-and-replace).
- **Single preview URL, always latest.** `preview/index.html` is overwritten on every actionable change and Caddy serves one port. Historical states live in the PR diff on GitHub.
- **PRs opened, never merged.** The PR is the human checkpoint; agent autonomy stops at "reviewable change."
- **JSON output instead of LLM tool calls.** The PI Agent SDK supports tool calling, but the OpenRouter + Gemini path didn't wire schemas through reliably. The system prompt asks for a strict JSON decision and we parse it ourselves. Swapping to real tool calls is a localized change in `src/agent/agent.ts`.
- **Three classifications: feature / preview / noise.** `preview` exists because users sometimes just want to see the page without making a change — mapping that to noise (no URL) or feature (spurious PR) both felt wrong.
- **Contents API, no `git clone`.** Octokit performs four calls (read → resolve base sha → create branch → commit → open PR). No local working copy, no temp directories.

---

## Setup

### Prerequisites

- Node.js ≥ 20.18.1
- Caddy on `PATH`
- A Slack workspace with a `#feedback` channel and a Slack app in Socket Mode
- A GitHub repo containing the target `index.html` on its base branch
- An OpenRouter account

### Slack app

Bot scopes: `channels:history`, `channels:read`, `chat:write`, `app_mentions:read`.
Event subscriptions: `message.channels`. Socket Mode app-level token with `connections:write`.
Install the app, invite the bot to `#feedback`.

### Run

```bash
cp .env.example .env   # fill in values
npm install
npm run dev
```

Expected boot logs:

```
[preview] seeded from GitHub main branch
[caddy] serving http://localhost:3000/
[slack] socket mode connected — listening for feedback
```

---

## Environment variables

All values live in `.env` (git-ignored). A `.env.example` template is committed.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `SLACK_BOT_TOKEN` | ✅ | — | Bot OAuth token (`xoxb-...`). |
| `SLACK_APP_TOKEN` | ✅ | — | App-level token for Socket Mode (`xapp-...`). |
| `SLACK_SIGNING_SECRET` | — | `""` | Optional with Socket Mode. |
| `SLACK_FEEDBACK_CHANNEL` | — | `feedback` | Channel name (no `#`). |
| `GITHUB_TOKEN` | ✅ | — | PAT with `repo` scope. |
| `GITHUB_OWNER` | ✅ | — | GitHub username or org that owns the target repo. |
| `GITHUB_REPO` | ✅ | — | Target repository name. |
| `GITHUB_BASE_BRANCH` | — | `main` | Branch the agent branches off and targets with its PRs. |
| `OPENROUTER_API_KEY` | ✅ | — | Used by pi-ai to call the model. |
| `OPENROUTER_MODEL` | — | `google/gemini-2.5-flash-lite-preview-09-2025` | OpenRouter model slug. |
| `CADDY_PORT` | — | `3000` | Local preview port. |
| `PREVIEW_DIR` | — | `preview` | Directory Caddy serves from. |

---

## Known limitations

- **No deduplication.** The same feedback posted twice opens two PRs.
- **Full-file output.** The model returns the entire `index.html` on every change. Fine at the current page size (~25 lines); will hit token limits as the file grows. A future upgrade would switch to a structured-edit schema for larger files.
- **Single preview URL.** Older Slack links will reflect whatever the agent most recently wrote. Per-PR previews are out of scope.
- **Single target file, single repo.** By design; supporting multiple files or repos would require reshaping the edit schema.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start in watch mode (recommended for development). |
| `npm start` | Start without watch. |
| `npm run typecheck` | Run `tsc --noEmit`. |
