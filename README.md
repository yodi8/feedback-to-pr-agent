# feedback-to-pr-agent

Autonomous Slack agent: watches `#feedback`, classifies messages, edits a single-file HTML
product page in a separate GitHub repo, opens a PR, and replies in-thread with the PR link
and a live Caddy-served preview URL.

## Architecture

```
Slack (#feedback message)
   └─> Bolt Socket Mode listener  [src/slack/listener.ts]
        └─> orchestrator          [src/agent/orchestrator.ts]
             ├─ GitHub: read index.html          [src/github/client.ts]
             ├─ LLM: classify + produce new HTML [src/agent/llm.ts]
             ├─ Caddy: write preview file        [src/caddy/server.ts]
             └─ GitHub: branch + commit + PR     [src/github/client.ts]
        └─> reply in thread (PR link + preview URL)
```

Each module has one job:

| File | Responsibility |
|---|---|
| `src/config.ts` | Loads + validates env vars. |
| `src/slack/listener.ts` | Bolt app; filters to `#feedback`, dispatches to orchestrator, replies in thread. |
| `src/agent/llm.ts` | Single call to OpenRouter returning JSON `{classification, updatedHtml, ...}`. |
| `src/agent/orchestrator.ts` | Glues LLM → GitHub → Caddy → Slack reply. |
| `src/github/client.ts` | Thin `fetch`-based GitHub REST wrapper: read file, branch, commit, open PR. |
| `src/caddy/server.ts` | Spawns `caddy file-server` on `CADDY_PORT`, writes the latest HTML to `preview/`. |
| `src/index.ts` | Boots: seed preview → start Caddy → start Slack. |

## Setup

1. `npm install`
2. Copy `.env.example` → `.env` and fill in values.
3. Make sure `caddy` is on your PATH (`caddy version`).
4. Invite your bot into `#feedback`.
5. `npm run dev`

## Design decisions & trade-offs

- **Direct `fetch` to OpenRouter instead of the PI Agent SDK.** The assignment allows this.
  For a single-shot classification + single-file rewrite, a stateful multi-tool agent loop
  adds complexity without buying anything: the "autonomy" is in the orchestrator, not in the
  model picking tools. Swapping to pi-agent-core later is a drop-in replacement inside
  `src/agent/llm.ts`.
- **Direct `fetch` to the GitHub REST API instead of Octokit.** Keeps the dependency surface
  small and the flow transparent — four HTTP calls (get file → get base sha → create ref →
  put contents → open PR).
- **Contents API, not `git clone`.** We never touch a working copy on disk. The Contents
  API edits a file on a new branch in a single `PUT`, which is exactly our scope.
- **Single preview URL, always latest.** `preview/index.html` is overwritten on every
  actionable change; Caddy serves it on one port. Historical states live in the PR diff on
  GitHub.
- **LLM returns the full file, not a diff.** Diffs are harder to apply reliably than a
  full-file rewrite at this size.
- **Socket Mode for Slack.** No public URL / ngrok needed; the bot dials out to Slack.

## TODOs / known limitations

- No retry/backoff on the LLM call.
- No deduping: the same feedback posted twice will open two PRs.
- `OPENROUTER_MODEL` in `.env.example` is a best guess for Gemini Flash Lite — update if the
  exact slug differs on OpenRouter.
