# feedback-to-pr-agent

An autonomous Slack agent that watches a `#feedback` channel, classifies each message, and — when the feedback requests a change — surgically edits a single-file HTML product page, opens a GitHub Pull Request, and replies in-thread with the PR link and a live local preview URL served by Caddy.

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

- **The LLM** decides *what* to do — classifying the message and, for features, producing a `{oldString, newString}` edit for `index.html`.
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
| **dotenv** | Env loading | Standard `.env` file parsing for local dev. |

### Key design choices

- **Single preview URL, always latest.** `preview/index.html` is overwritten on each actionable change and Caddy serves it on one port. Historical states live in the PR diff on GitHub.
- **Surgical find-and-replace edits.** The LLM returns `{oldString, newString}` pairs. The orchestrator rejects edits whose `oldString` doesn't appear exactly once, which prevents accidental reformatting of unchanged regions.
- **PRs are opened, never merged.** The PR is the human checkpoint. The agent's autonomy stops at "reviewable change."
- **JSON-output parsing instead of LLM tool calls.** The PI Agent SDK exposes tool calling, but the OpenRouter + Gemini path didn't wire schemas through reliably at the time of writing. Instead, the system prompt asks for a strict JSON decision and we parse it deterministically. Swapping to real tool calls later is a localized change in `src/agent/agent.ts`.
- **Octokit over raw `fetch`.** Four HTTP calls (read file → get `main` sha → create branch → commit → open PR) expressed as typed methods that read top-to-bottom.
- **No cloning.** The GitHub Contents API edits a single file on a new branch in one `PUT`. No local working copy, no temp directories.

---

## Setup

### Prerequisites

- **Node.js ≥ 20.18.1** (lower versions warn on `undici` and may fail at runtime).
- **[Caddy](https://caddyserver.com/docs/install)** on your `PATH` (`caddy version` should print a version).
- A **Slack workspace** you control, with a `#feedback` channel.
- A **GitHub repository** containing an `index.html` product page on `main`. The agent operates on this repo.
- An **OpenRouter** account with a small balance ($1 is plenty).

### 1. Slack app

Create a new app at https://api.slack.com/apps → *From scratch*.

- **Socket Mode** → Enable → generate an **App-Level Token** with `connections:write` scope (save as `SLACK_APP_TOKEN`, starts with `xapp-`).
- **OAuth & Permissions** → add these **Bot Token Scopes**:
  - `channels:history`
  - `channels:read`
  - `chat:write`
  - `app_mentions:read`
- **Event Subscriptions** → Enable → subscribe to bot event `message.channels`.
- Install the app to your workspace. Copy the **Bot User OAuth Token** (`xoxb-...`) into `SLACK_BOT_TOKEN`.
- In Slack: `/invite @your-bot` inside `#feedback`.

> If you change scopes later, click **Reinstall to Workspace** — the existing token is reused.

### 2. GitHub token

Generate a **Personal Access Token (classic)** at https://github.com/settings/tokens with the `repo` scope (required for private repos). Save as `GITHUB_TOKEN`.

### 3. OpenRouter key

Create a key at https://openrouter.ai/keys and save as `OPENROUTER_API_KEY`. Add ~$1 of credit.

### 4. Install and run

```bash
git clone <this-repo-url>
cd feedback-to-pr-agent

cp .env.example .env   # then fill in values (see below)
npm install
npm run dev
```

You should see:

```
[preview] seeded from GitHub main branch
[caddy] serving http://localhost:3000/
[slack] socket mode connected — listening for feedback
```

Open `http://localhost:3000/` to confirm the preview is live, then post a message in `#feedback`.

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

- **No retry/backoff on the LLM call.** A 429 or transient 5xx bubbles up as a Slack error.
- **No deduplication.** The same feedback posted twice opens two PRs.
- **Small model, simple math.** Gemini Flash Lite may miss arithmetic-heavy feedback (e.g., currency conversions that require multiplying). Upgrade `OPENROUTER_MODEL` if this matters.
- **Single preview URL.** Older Slack links will reflect whatever the agent most recently wrote. Per-PR previews are out of scope.
- **Single target file, single repo.** By design; supporting multiple files or repos would require reshaping the edit schema.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start in watch mode (recommended for development). |
| `npm start` | Start without watch. |
| `npm run typecheck` | Run `tsc --noEmit`. |
