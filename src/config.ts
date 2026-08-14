// Loop configuration: budgets, staleness, target roles, scoring weights, sources.
// Everything tunable lives here so the loop's behavior is auditable in one place.

import type { TargetRole, ScoreComponents } from "./types.ts";

export const config = {
  /** Path to the SQLite state store (committed as the audit trail). */
  dbPath: process.env.AJR_DB_PATH ?? "state/ajr.db",

  /** Stop conditions / budgets (design §6). */
  limits: {
    maxWallClockMs: 30 * 60 * 1000,
    maxFetchesPerRun: 300,
    maxNewCandidatesPerDay: 50,
    maxRefreshPerDay: 100,
    maxRetriesPerItem: 2,
  },

  /** Staleness windows: how often a company is re-scored (design §6). */
  staleness: {
    defaultDays: 7,
    /** Companies with a round in the last N days refresh faster. */
    fundingActiveDays: 2,
  },

  /** Growth-score component weights (must sum to 100). Traction + hiring
   *  dominate so a marquee cap table alone can't rank as growth (E2). */
  scoreWeights: {
    fundingMomentum: 30,
    customerTraction: 25,
    hiringVelocity: 20,
    productMomentum: 15,
    evidenceQuality: 10,
  } satisfies Record<keyof ScoreComponents, number>,

  /** Bucketing thresholds (design N9 + E2). */
  buckets: {
    topMoverMinScore: 65,
    /** A company needs real traction+hiring, not just funding, to be a top mover. */
    topMoverMinTractionHiring: 0.45,
    notableUnprovenMinScore: 30,
  },

  /** Wylie's target role families → curated, role-defining TITLE forms.
   *  The deterministic matcher is title-first (E3 follow-up): substring matching on
   *  JD bodies floods with false positives ("Legal Counsel" that mentions "product
   *  manager" in passing), so body/semantic matching is deferred to the LLM node. */
  targetRoles: {
    "solutions-engineer": [
      "solutions engineer", "solutions architect", "solutions consultant",
      "sales engineer", "applied ai architect", "ai architect", "pre-sales", "presales",
    ],
    "sales-engineer": ["sales engineer"],
    "product-manager": [
      "product manager", "product management", "group product manager", "gpm",
      "head of product", "director of product", "director, product", "principal product",
    ],
    "partnerships": [
      "partnerships", "partner manager", "partner enablement", "strategic partnership",
      "alliances", "channel account", "gtm partnership", "gtm lead", "business development manager",
    ],
    "forward-deployed": [
      "forward deployed", "forward-deployed", "deployment engineer", "deployment strategist",
      "field engineer",
    ],
  } satisfies Record<TargetRole, string[]>,

  /** Titles containing any of these are never target matches, even if the JD body
   *  mentions target terms (recruiters/legal/marketing that hire or support these roles). */
  excludeTitles: [
    "recruit", "recruiting", "recruiter", "sourcer", "talent",
    "legal", "counsel", "paralegal",
    "marketing", "brand", "content", "social media", "communications",
    "designer", "design engineer",
    "accountant", "controller", "bookkeep", "payroll", "finance",
    "people partner", "people ops", "office manager", "executive assistant", "events", "event ",
  ],

  /** Seniority ceiling used to raise a fit_caveat on very senior roles (E3). */
  seniorityCaveatYears: 8,

  /** Email delivery (this project's OWN resources — Resend API key in this repo's
   *  .env, never another project's). Recipient is fixed to Wylie's inbox by default. */
  email: {
    to: process.env.AJR_EMAIL_TO ?? "wyliebrown1990@gmail.com",
    /** Verified Resend sender, e.g. "AI Job Researcher <digest@yourdomain.com>". */
    from: process.env.AJR_EMAIL_FROM ?? "",
    /** Resend API key — this project's own key. Absent => email is skipped (file only). */
    resendApiKey: process.env.RESEND_API_KEY ?? "",
  },
} as const;

export type Config = typeof config;
