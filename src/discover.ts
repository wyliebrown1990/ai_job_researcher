// DISCOVER node (design N3) — the LLM edge of the loop.
// Claude, with the server-side web-search tool, finds AI companies that raised or
// launched in the last few days and returns structured Candidates. The deterministic
// ingest layer (ingest.ts) then applies the identity/rumor/evidence rules — the LLM
// never writes to the watchlist directly.
//
// Uses THIS project's own Anthropic key (ANTHROPIC_API_KEY in .env). Model defaults
// to claude-opus-5; override with AJR_LLM_MODEL (e.g. claude-sonnet-5 to cut cost).

import Anthropic from "@anthropic-ai/sdk";
import type { Candidate } from "./types.ts";

const MODEL = process.env.AJR_LLM_MODEL ?? "claude-opus-5";

const SYSTEM = `You are a research analyst tracking the AI industry for a technical
go-to-market professional (Sales Engineer / Solutions Engineer / Product Manager /
Partnerships). Your job: surface AI companies showing REAL, quantifiable momentum —
prioritizing companies likely to hire those roles (enterprise/agentic/applied AI over
pure research labs).

Rules you MUST follow:
- Prefer companies with a dated funding event or product launch in the last ~4 days.
- Distinguish a CLOSED round ("raised", "closed", "announced", "led by") from a RUMOR
  ("in talks", "reportedly", "is seeking") — report the exact phrasing in claimText.
- Only include a company's "domain" if you are confident it is their real primary
  domain. NEVER guess a domain. Omit it if unsure.
- Every company needs at least one dated source URL. No source, no company.
- Keep customerTraction/productMomentum estimates conservative (0..1); aspirational
  goals ("targeting 100 customers") are not traction.`;

function userPrompt(now: string): string {
  return `Today is ${now}. Find 5–15 AI companies with recent, quantifiable momentum
(funding closed or rumored, notable launches, strong hiring signals). Use web search.

Return ONLY a JSON array (in a \`\`\`json code block) of objects with this shape:
[{
  "displayName": string,
  "domain": string | null,               // real primary domain, or null if unsure
  "description": string,
  "category": string,
  "hq": string | null,
  "foundedYear": number | null,
  "funding": {                            // omit if none found
    "claimText": string,                  // exact phrasing, e.g. "raised $150M Series C"
    "amountText": string | null,          // e.g. "$150M"
    "valuationText": string | null,       // e.g. "$1.2B"
    "stageText": string | null,           // e.g. "Series C"
    "leadInvestors": string[],
    "otherInvestors": string[],
    "announcedDate": string | null        // ISO YYYY-MM-DD
  } | null,
  "namedCustomers": string[],
  "judgments": { "customerTraction": number, "productMomentum": number },
  "sources": [{ "url": string, "date": string, "primary": boolean }],
  "notes": string | null
}]`;
}

/** Extract the JSON array from the model's final text (tolerant of prose around it). */
export function extractCandidates(text: string): Candidate[] {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1]! : text.slice(text.indexOf("["), text.lastIndexOf("]") + 1);
  try {
    const parsed = JSON.parse(raw.trim());
    if (Array.isArray(parsed)) return parsed as Candidate[];
  } catch {
    // fall through
  }
  return [];
}

export function discoveryConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export async function discoverCandidates(now = new Date()): Promise<Candidate[]> {
  if (!discoveryConfigured()) {
    throw new Error("ANTHROPIC_API_KEY not set — discovery needs this project's own key (see .env.example)");
  }
  const client = new Anthropic();
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: userPrompt(now.toISOString().slice(0, 10)) },
  ];
  const tools: Anthropic.ToolUnion[] = [
    { type: "web_search_20260209", name: "web_search", max_uses: 12 },
  ];

  // Server-side web search runs a loop; it may pause with stop_reason "pause_turn".
  // Resend the accumulated turns to resume until the model produces its final answer.
  let finalText = "";
  for (let guard = 0; guard < 8; guard++) {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      tools,
      messages,
    });
    if (res.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: res.content });
      continue;
    }
    finalText = res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n");
    break;
  }
  return extractCandidates(finalText);
}
