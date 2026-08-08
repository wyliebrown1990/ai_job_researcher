// Core domain model for the AI-industry research loop.
// See docs/AGENT_LOOP_DESIGN.md for how these map onto the node graph.

/** A single dated, sourced claim. The evidence hard-gate (C4) requires every
 *  surfaced fact to carry one of these. */
export interface Evidence {
  claim: string;
  sourceUrl: string;
  /** ISO date (YYYY-MM-DD) the source is dated / was retrieved. */
  date: string;
  /** Is this a primary source (press release, official blog, ATS/SEC) vs an
   *  aggregator/secondary echo? Primary wins on conflict (E1/E5). */
  primary: boolean;
}

export type FundingStage =
  | "pre-seed"
  | "seed"
  | "series-a"
  | "series-b"
  | "series-c"
  | "series-d-plus"
  | "growth"
  | "unknown";

/** A CLOSED round only. Rumors ("in talks") are never funding events (E5). */
export interface FundingEvent {
  stage: FundingStage;
  /** Amount raised in USD, if disclosed. */
  amountUsd?: number;
  /** Post-money valuation in USD, if disclosed. */
  valuationUsd?: number;
  leadInvestors: string[];
  otherInvestors: string[];
  /** ISO date the round closed / was announced. */
  announcedDate: string;
  evidence: Evidence[];
}

/** Result of classifying funding language (E5). */
export type FundingClaimKind = "event" | "rumor" | "none";

/** The five growth-score components (0..1 each before weighting). */
export interface ScoreComponents {
  fundingMomentum: number;
  customerTraction: number;
  hiringVelocity: number;
  productMomentum: number;
  evidenceQuality: number;
}

export type Confidence = "high" | "medium" | "low";

export type DigestBucket =
  | "top-mover"
  | "new-entrant"
  | "notable-unproven"
  | "watching"
  | "review-queue";

export interface GrowthScore {
  /** 0..100 weighted score. */
  score: number;
  components: ScoreComponents;
  /** Per-component weighted contribution, for an auditable breakdown. */
  breakdown: Record<keyof ScoreComponents, number>;
  confidence: Confidence;
  bucket: DigestBucket;
}

/** Wylie's target role families (from the brief). */
export type TargetRole =
  | "solutions-engineer"
  | "sales-engineer"
  | "product-manager"
  | "partnerships"
  | "forward-deployed";

export interface JobPosting {
  /** Stable id from the ATS. */
  externalId: string;
  title: string;
  team?: string;
  location: string;
  isRemote?: boolean;
  employmentType?: string;
  /** ISO date the posting was published, if the ATS provides it. */
  publishedDate?: string;
  url: string;
  /** Raw JD text/HTML if fetched (used for body matching, E3). */
  descriptionText?: string;
  /** ISO timestamp this posting was retrieved (postings churn, E3). */
  retrievedAt: string;
}

export interface RoleMatch {
  job: JobPosting;
  role: TargetRole;
  /** 0..1 how well the title+body match the target family. */
  matchScore: number;
  /** Honest caveat — title match is not fit (E1/E3). e.g. seniority, coding depth. */
  fitCaveat?: string;
  /** Whether the match came from the title, the JD body, or the department (E3). */
  matchedOn: ("title" | "body" | "team")[];
}

export type CompanyStatus = "watching" | "promising" | "applied" | "archived";

/** ATS provider for a company's job board. */
export type AtsProvider = "ashby" | "greenhouse" | "lever" | "unknown";

export interface Company {
  /** Canonical identity = normalized primary domain (E4). Never the display name. */
  domain: string;
  displayName: string;
  /** All names this company has been seen under, for dedup (E4). */
  aliases: string[];
  description?: string;
  hq?: string;
  foundedYear?: number;
  category?: string;

  status: CompanyStatus;

  /** Most recent CLOSED round (E5: rumors excluded). */
  latestFunding?: FundingEvent;
  totalRaisedUsd?: number;

  ats?: { provider: AtsProvider; slug: string };
  openRolesCount?: number;
  /** Open-roles count at the previous run, for hiring-velocity delta. */
  priorOpenRolesCount?: number;

  score?: GrowthScore;
  /** Score from the previous run, for digest deltas (▲/▼). */
  priorScore?: number;

  /** Judgment sub-scores (0..1) supplied by research/LLM/human — the components we
   *  can't yet compute deterministically (E2: kept-manual). Persisted so re-scoring
   *  is reproducible between runs. */
  judgments?: { customerTraction?: number; productMomentum?: number };

  /** Role families to alert on even if not currently open (E1 role_watch). */
  roleWatches: TargetRole[];

  evidence: Evidence[];

  /** ISO timestamps. */
  firstSeen: string;
  lastUpdated: string;
  /** How many times we've seen this company across sources (E4). */
  sightings: number;
}

/** An item that failed verification and needs human eyes (never silently dropped). */
export interface ReviewItem {
  domain?: string;
  displayName: string;
  reason:
    | "rumored_unconfirmed"
    | "primary_paywalled"
    | "url_dead"
    | "single_source"
    | "undated"
    | "aspirational_claim"
    | "no_domain"
    | "hype_only";
  detail: string;
  evidence: Evidence[];
  createdAt: string;
}
