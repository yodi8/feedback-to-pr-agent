import { config } from "../config.js";

export type Classification = "bug" | "feature" | "noise";

export interface AgentDecision {
  classification: Classification;
  reason: string;                  // one short sentence, for the PR body + Slack
  updatedHtml?: string;            // full new HTML file (only when classification !== "noise")
  prTitle?: string;                // short, imperative
  prSummary?: string;              // 1–3 sentence body for the PR
  changeSummary?: string;          // one short sentence for Slack thread
}

const SYSTEM_PROMPT = `You are an autonomous engineering agent that reacts to feedback about a single static HTML product page.

Given:
- The current full contents of index.html.
- One feedback message from a user.

You must respond with a SINGLE JSON object — no markdown, no commentary — matching exactly this schema:
{
  "classification": "bug" | "feature" | "noise",
  "reason": string,                 // one short sentence describing what you understood
  "updatedHtml": string | null,     // the COMPLETE new file contents, or null for noise
  "prTitle": string | null,         // short imperative PR title, or null for noise
  "prSummary": string | null,       // 1-3 sentence PR description, or null for noise
  "changeSummary": string | null    // one short sentence describing the change for a Slack reply, or null for noise
}

Rules:
- "noise" means the message has no actionable code change (praise, questions, off-topic). Set all other fields to null.
- For "bug" or "feature": return the FULL updated HTML, not a diff. Preserve existing structure/styles unless the change requires otherwise. Make the smallest edit that satisfies the feedback.
- Never include explanations outside the JSON. Never wrap in code fences.`;

export async function decide(feedback: string, currentHtml: string): Promise<AgentDecision> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.llm.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.llm.model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Feedback: ${feedback}\n\n--- current index.html ---\n${currentHtml}`,
        },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  }

  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  const raw = data.choices[0]?.message.content ?? "";
  const parsed = JSON.parse(raw) as {
    classification: Classification;
    reason: string;
    updatedHtml: string | null;
    prTitle: string | null;
    prSummary: string | null;
    changeSummary: string | null;
  };

  return {
    classification: parsed.classification,
    reason: parsed.reason,
    updatedHtml: parsed.updatedHtml ?? undefined,
    prTitle: parsed.prTitle ?? undefined,
    prSummary: parsed.prSummary ?? undefined,
    changeSummary: parsed.changeSummary ?? undefined,
  };
}
