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

/** Personal constraints used to decide which live ATS matches are worth surfacing. */
export type RemotePreference = "any" | "remote-only" | "remote-or-location" | "location-only";

/** The strength of a company-level search preference. Role location/remote rules
 * remain hard constraints in the dedicated fields below. */
export type PreferenceStrength = "preferred" | "required";
export type TeamSizeBand = "1-10" | "11-50" | "51-200" | "201-1000" | "1000-plus";
export type EquityPriority = "not-a-factor" | "nice-to-have" | "important" | "must-discuss";
export type SignalInterest = "funding" | "traction" | "hiring" | "launches" | "leadership" | "open-roles";
export type MatchedRole = TargetRole | "custom";

/** Optional company facts that are retained only when the discovery response cites
 * one of its dated sources. Missing data remains explicitly unknown. */
export interface CompanySearchFacts {
  teamSize?: TeamSizeBand;
  businessModelTags: string[];
  equityMentioned?: boolean;
}

export interface SearchProfile {
  targetRoles: TargetRole[];
  /** Additional title phrases, matched against titles only for precision. */
  customTitlePhrases: string[];
  /** Jobs without an explicit years requirement remain eligible. */
  minExperienceYears?: number;
  maxExperienceYears?: number;
  acceptedLocations: string[];
  remotePreference: RemotePreference;
  includedSectors: string[];
  sectorPreferenceStrength: PreferenceStrength;
  businessModelThemes: string[];
  preferredStages: FundingStage[];
  stagePreferenceStrength: PreferenceStrength;
  preferredTeamSizes: TeamSizeBand[];
  teamSizePreferenceStrength: PreferenceStrength;
  excludedCompanyDomains: string[];
  equityPriority: EquityPriority;
  compensationNote: string;
  signalInterests: SignalInterest[];
  /** Bounded plain-language intent that supplements structured criteria. */
  searchBrief: string;
  excludedKeywords: string[];
  minCompanyScore: number;
  updatedAt: string;
}

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

/** Personal fit is an explainable ranking, never a change to Growth Score. */
export interface SearchRelevance {
  included: boolean;
  score: number;
  label: "strong" | "match" | "explore" | "outside-criteria";
  reasons: string[];
}

export interface RoleMatch {
  job: JobPosting;
  role: MatchedRole;
  /** 0..1 how well the title+body match the target family. */
  matchScore: number;
  /** Honest caveat — title match is not fit (E1/E3). e.g. seniority, coding depth. */
  fitCaveat?: string;
  /** Whether the match came from the title, the JD body, or the department (E3). */
  matchedOn: "title"[];
  relevance?: SearchRelevance;
}

/** A user's lightweight disposition for one live ATS posting. */
export interface RoleState {
  domain: string;
  externalId: string;
  saved: boolean;
  hidden: boolean;
  applied: boolean;
  fitOverride?: "good" | "maybe" | "poor";
  createdAt: string;
  updatedAt: string;
}

export type ApplicationStatus = "researching" | "networking" | "applied" | "interviewing" | "closed";

/** A deliberate application workflow record, separate from company status. */
export interface Application {
  id: number;
  domain: string;
  externalId: string;
  status: ApplicationStatus;
  notes: string;
  nextActionAt?: string;
  appliedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Snapshot {
  domain: string;
  runDate: string;
  score?: number;
  bucket?: DigestBucket;
  confidence?: Confidence;
  openRolesCount?: number;
  matchingRolesCount?: number;
  fundingTotalUsd?: number;
  createdAt: string;
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
  /** Local manual-add progress; a missing board is honest research-only coverage. */
  atsDetection?: "checking" | "available" | "not-detected";
  atsCheckedAt?: string;
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
  searchFacts?: CompanySearchFacts;

  /** Role families to alert on even if not currently open (E1 role_watch). */
  roleWatches: TargetRole[];

  /** Local research intent. These values are stored in dedicated SQLite columns. */
  pinned?: boolean;
  notes?: string;

  evidence: Evidence[];

  /** ISO timestamps. */
  firstSeen: string;
  lastUpdated: string;
  /** How many times we've seen this company across sources (E4). */
  sightings: number;
}

/** Raw candidate emitted by the LLM DISCOVER node, before deterministic ingest. */
export interface Candidate {
  displayName: string;
  /** Company's own primary domain if the model could identify it (E4: no guessing). */
  domain?: string;
  description?: string;
  category?: string;
  hq?: string;
  foundedYear?: number;
  /** Funding as the model found it — the deterministic classifier decides event vs rumor (E5). */
  funding?: {
    /** The headline/phrasing, e.g. "raised $150M Series C" or "in talks to raise". */
    claimText: string;
    amountText?: string;
    valuationText?: string;
    stageText?: string;
    leadInvestors?: string[];
    otherInvestors?: string[];
    announcedDate?: string; // ISO
  };
  /** Traction the model observed (for judgment sub-scores; aspirational claims flagged). */
  namedCustomers?: string[];
  /** Model's 0..1 estimate of traction/product momentum (kept-manual signals). */
  judgments?: { customerTraction?: number; productMomentum?: number };
  fitFacts?: {
    teamSize?: TeamSizeBand;
    businessModelTags?: string[];
    equityMentioned?: boolean;
    sourceUrls?: string[];
  };
  /** Dated sources backing the above (evidence hard-gate, C4). */
  sources: { url: string; date?: string; primary?: boolean }[];
  notes?: string;
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
