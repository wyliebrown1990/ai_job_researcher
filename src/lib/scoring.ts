// Growth scoring (design N5 + E2).
// Traction + hiring dominate, so a marquee cap table alone cannot rank as growth.
// funding_event is tracked separately (types.ts) and always eligible for the Funding
// section regardless of this score.

import type {
  ScoreComponents, GrowthScore, Confidence, DigestBucket, FundingEvent,
} from "../types.ts";
import { config } from "../config.ts";

function daysSince(iso: string, now: Date): number {
  const then = new Date(iso + (iso.length <= 10 ? "T00:00:00Z" : "")).getTime();
  return (now.getTime() - then) / 86_400_000;
}

/** Log-ish normalization of a USD funding amount to 0..1 (≈$1M→0.2, $150M→0.75, $1B→~0.9). */
function normAmount(usd: number | undefined): number {
  if (!usd || usd <= 0) return 0;
  return Math.max(0, Math.min(1, (Math.log10(usd) - 6) / 3)); // 1e6..1e9 -> 0..1
}

/** Recency decay: full weight within `fresh` days, linearly to 0 by `stale` days. */
function recency(days: number, fresh = 7, stale = 120): number {
  if (days <= fresh) return 1;
  if (days >= stale) return 0;
  return 1 - (days - fresh) / (stale - fresh);
}

export interface SignalInputs {
  fundingEvent?: FundingEvent;
  openRolesCount?: number;
  priorOpenRolesCount?: number;
  newestEvidenceDate?: string;
  primarySourceCount?: number;
  totalSourceCount?: number;
  /** Judgment inputs (LLM/human), 0..1. Default 0 => unproven, not penalized as negative. */
  customerTraction?: number;
  productMomentum?: number;
}

/** Derive the five 0..1 components from raw + judgment signals. */
export function deriveComponents(s: SignalInputs, now = new Date()): ScoreComponents {
  // Funding momentum: amount x recency (a stale round contributes little).
  const fund = s.fundingEvent;
  const fundingMomentum = fund
    ? normAmount(fund.amountUsd) * recency(daysSince(fund.announcedDate, now))
    : 0;

  // Hiring velocity: growth in open roles, blended with absolute breadth.
  const cur = s.openRolesCount ?? 0;
  const prior = s.priorOpenRolesCount;
  const breadth = Math.max(0, Math.min(1, cur / 40)); // 40+ open roles => full breadth
  let hiringVelocity: number;
  if (prior === undefined) {
    hiringVelocity = breadth; // no baseline yet -> use breadth only
  } else {
    const delta = cur - prior;
    const growth = Math.max(0, Math.min(1, delta / 15)); // +15 roles => full
    hiringVelocity = 0.6 * growth + 0.4 * breadth;
  }

  // Evidence quality: primary-source ratio x recency of newest evidence.
  const total = s.totalSourceCount ?? 0;
  const primaryRatio = total > 0 ? (s.primarySourceCount ?? 0) / total : 0;
  const evRecency = s.newestEvidenceDate ? recency(daysSince(s.newestEvidenceDate, now), 3, 60) : 0;
  const evidenceQuality = total === 0 ? 0 : 0.6 * primaryRatio + 0.4 * evRecency;

  return {
    fundingMomentum,
    customerTraction: clamp01(s.customerTraction ?? 0),
    hiringVelocity: clamp01(hiringVelocity),
    productMomentum: clamp01(s.productMomentum ?? 0),
    evidenceQuality: clamp01(evidenceQuality),
  };
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
}

export interface ScoreOpts {
  isNew?: boolean;
  /** No resolvable domain (E4) — force to review queue. */
  unresolved?: boolean;
}

export function scoreCompany(components: ScoreComponents, opts: ScoreOpts = {}): GrowthScore {
  const w = config.scoreWeights;
  const breakdown = {
    fundingMomentum: components.fundingMomentum * w.fundingMomentum,
    customerTraction: components.customerTraction * w.customerTraction,
    hiringVelocity: components.hiringVelocity * w.hiringVelocity,
    productMomentum: components.productMomentum * w.productMomentum,
    evidenceQuality: components.evidenceQuality * w.evidenceQuality,
  };
  const score = Math.round(
    breakdown.fundingMomentum + breakdown.customerTraction + breakdown.hiringVelocity +
    breakdown.productMomentum + breakdown.evidenceQuality,
  );

  const confidence = deriveConfidence(components);
  const bucket = pickBucket(score, components, opts);
  return { score, components, breakdown, confidence, bucket };
}

function deriveConfidence(c: ScoreComponents): Confidence {
  // Confidence tracks how well-evidenced the picture is, not how high the score is.
  if (c.evidenceQuality >= 0.66 && (c.customerTraction > 0 || c.hiringVelocity >= 0.3)) return "high";
  if (c.evidenceQuality >= 0.33) return "medium";
  return "low";
}

/**
 * Bucket priority (E2): a company needs real traction+hiring — not just a round — to
 * be a Top Mover. Well-funded-but-unproven lands in "notable-unproven".
 */
export function pickBucket(score: number, c: ScoreComponents, opts: ScoreOpts): DigestBucket {
  if (opts.unresolved) return "review-queue";
  const tractionHiring = (c.customerTraction + c.hiringVelocity) / 2;
  const isMover = score >= config.buckets.topMoverMinScore &&
    tractionHiring >= config.buckets.topMoverMinTractionHiring;

  if (isMover) return "top-mover";
  // A recent, real funding event is inherently notable even at a low growth score —
  // it must surface in "Notable but unproven", never vanish into "watching" (E2).
  if (c.fundingMomentum > 0) return "notable-unproven";
  if (opts.isNew && score >= config.buckets.notableUnprovenMinScore) return "new-entrant";
  return "watching";
}
