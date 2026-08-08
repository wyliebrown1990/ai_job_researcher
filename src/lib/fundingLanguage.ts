// Funding-language classifier (E5): rumor vs closed round.
// A dated, CLOSED round is a funding event (eligible for the Funding section).
// "in talks / reportedly / is seeking" is a rumor -> review queue, never an event.

import type { FundingClaimKind, FundingStage } from "../types.ts";

const RUMOR_PATTERNS: RegExp[] = [
  /\bin\s+(?:advanced\s+)?talks\b/i,
  /\breportedly\b/i,
  /\brumou?red\b/i,
  /\bis\s+seeking\b/i,
  /\blooking\s+to\s+raise\b/i,
  /\bcould\s+raise\b/i,
  /\bin\s+discussions?\b/i,
  /\bnearing\s+a\s+deal\b/i,
  /\bexpected\s+to\s+raise\b/i,
  /\bmay\s+raise\b/i,
  /\bplans?\s+to\s+raise\b/i,
];

const EVENT_PATTERNS: RegExp[] = [
  /\braised\b/i,
  /\braises\b/i,
  /\bhas\s+raised\b/i,
  /\bcloses?\b/i,
  /\bclosed\b/i,
  /\bsecured\b/i,
  /\bannounc(?:ed|es)\b/i,
  /\bled\s+by\b/i,
  /\blands?\b/i,
  /\bbags?\b/i,
  /\bcompletes?\b/i,
];

/**
 * Classify a funding headline/snippet. Rumor language wins over event language when
 * both appear ("reportedly raised" is still unconfirmed) — we bias toward caution so
 * nothing unconfirmed becomes a funding_event.
 */
export function classifyFundingClaim(text: string): FundingClaimKind {
  const t = text ?? "";
  const rumor = RUMOR_PATTERNS.some((re) => re.test(t));
  if (rumor) return "rumor";
  const event = EVENT_PATTERNS.some((re) => re.test(t));
  if (event) return "event";
  return "none";
}

/** Best-effort funding-stage parse from free text. */
export function parseStage(text: string): FundingStage {
  const t = (text ?? "").toLowerCase();
  if (/\bpre[\s-]?seed\b/.test(t)) return "pre-seed";
  if (/\bseed\b/.test(t)) return "seed";
  if (/\bseries\s*a\b/.test(t)) return "series-a";
  if (/\bseries\s*b\b/.test(t)) return "series-b";
  if (/\bseries\s*c\b/.test(t)) return "series-c";
  if (/\bseries\s*[d-z]\b/.test(t)) return "series-d-plus";
  if (/\bgrowth\b/.test(t)) return "growth";
  return "unknown";
}

/**
 * Parse a USD amount like "$150M", "$1.2 billion", "$20 million" to a number.
 * Returns undefined if no amount is present.
 */
export function parseUsdAmount(text: string): number | undefined {
  const m = (text ?? "").match(/\$\s?([\d,.]+)\s*(k|thousand|m|million|b|billion|bn)?/i);
  if (!m) return undefined;
  const num = parseFloat(m[1]!.replace(/,/g, ""));
  if (Number.isNaN(num)) return undefined;
  const unit = (m[2] ?? "").toLowerCase();
  const mult =
    unit === "k" || unit === "thousand" ? 1e3
    : unit === "m" || unit === "million" ? 1e6
    : unit === "b" || unit === "bn" || unit === "billion" ? 1e9
    : 1;
  return num * mult;
}
