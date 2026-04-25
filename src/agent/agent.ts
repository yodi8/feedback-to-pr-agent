import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { config } from "../config.js";
import { readIndexHtml } from "../github/client.js";

const SYSTEM_PROMPT = `You are an autonomous engineering agent that reacts to product feedback on a single HTML page.

You will receive one feedback message and the current contents of index.html.

Decide exactly one of:
- "feature" — the message requests a concrete change to the page. Produce a surgical find-and-replace
  edit. Keep it as small as possible. oldString MUST appear exactly once in the file.
- "preview" — the message is just asking to see / view / look at the current page, with no change
  requested. No edit needed; the user will be shown the live preview URL.
- "noise" — the message is praise, a question, a comment, or anything else that doesn't fit the two
  above.

If the feedback asks for multiple distinct changes (e.g. "change the title AND add a logo"),
produce one entry per change in the "edits" array. Each edit is applied in order.

Reply with a SINGLE JSON object and nothing else (no markdown, no code fences, no prose before or
after). Schema:

{
  "decision": "feature" | "preview" | "noise",
  "reply": string,                  // one short sentence to post back to the user in Slack
  "edits": [                        // ONLY when decision === "feature" (empty array otherwise).
    {
      "oldString": string,          // exact substring in index.html, appearing once
      "newString": string
    }
  ],
  "prTitle": string | null,         // short imperative PR title; required when decision === "feature"
  "prBody": string | null,          // 1-3 sentence PR description; required when decision === "feature"
  "changeSummary": string | null    // one short sentence summarising all changes for Slack
}`;

export interface AgentDecision {
  decision: "feature" | "preview" | "noise";
  reply: string;
  edits: { oldString: string; newString: string }[];
  prTitle: string | null;
  prBody: string | null;
  changeSummary: string | null;
}

export async function runAgent(feedback: string): Promise<AgentDecision> {
  const { content: currentHtml } = await readIndexHtml();

  const agent = new Agent({
    initialState: {
      systemPrompt: SYSTEM_PROMPT,
      model: getModel("openrouter", config.llm.model as any),
    },
  });

  let raw = "";

  // Stream the agent's thinking to the terminal so we can see what it's doing.
  agent.subscribe((event: any) => {
    if (event.type === "message_update") {
      const e = event.assistantMessageEvent;
      if (e?.type === "text_delta" && typeof e.delta === "string") {
        process.stdout.write(e.delta);
        raw += e.delta;
      }
    }
  });

  console.log(`\n[agent] ─── reasoning ───`);
  await agent.prompt(
    `Feedback: ${feedback}\n\n--- current index.html ---\n${currentHtml}`,
  );
  console.log(`\n[agent] ─── done ───\n`);

  return parseDecision(raw);
}

/** Pull a JSON object out of the model's output, tolerating accidental code fences. */
function parseDecision(raw: string): AgentDecision {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();

  // Fallback: if the model added surrounding text, grab the first {...} block.
  const match = cleaned.match(/\{[\s\S]*\}/);
  const jsonText = match ? match[0] : cleaned;

  try {
    return JSON.parse(jsonText) as AgentDecision;
  } catch (err) {
    throw new Error(`Agent returned invalid JSON:\n${raw}`);
  }
}
