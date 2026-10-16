// Loop configuration: budgets, staleness, target roles, scoring weights, sources.
// Everything tunable lives here so the loop's behavior is auditable in one place.

import type { TargetRole, ScoreComponents } from "./types.ts";

export const config = {
  /** Path to the SQLite state store (committed as the audit trail). */
  dbPath: process.env.AJR_DB_PATH ?? "state/ajr.db",

  /** Stop conditions / budgets (design §6). */
  limits: {
    maxWallClockMs: 30 * 60 * 1000,
    // Domain + careers resolution adds a handful of page fetches per company.
    maxFetchesPerRun: 600,
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
   *  JD bodies floods with false positives ("Legal Counsel" that mentions "sales
   *  engineer" in passing), so body/semantic matching is deferred to the LLM node.
   *
   *  Scope is technical pre-sales only: the people who run discovery, demos, POCs and
   *  technical evaluations alongside AEs, and the leaders of those teams. Product
   *  management, partnerships and forward-deployed/implementation engineering are out.
   *  Families are checked in order, so applied-AI titles group before the generic
   *  "solutions engineer"/"solutions architect" forms they may also contain. */
  targetRoles: {
    "applied-ai": [
      "applied ai consultant", "applied ai architect", "applied ai specialist",
      "applied ai strategist", "applied ai advisor", "applied ai solutions",
      "ai consultant", "ai solutions consultant",
    ],
    "sales-engineer": [
      "sales engineer", "solutions engineer", "solution engineer",
      "solutions engineering", "solution engineering",
      "presales engineer", "pre-sales engineer", "pre sales engineer",
      "customer engineer",
    ],
    "solutions-consultant": [
      "solutions consultant", "solution consultant", "solutions consulting", "solution consulting",
      "solutions architect", "solution architect", "solutions architecture",
      "technical sales consultant", "presales", "pre-sales", "pre sales",
    ],
    "se-leadership": [
      "field cto", "head of solutions", "director of solutions", "director, solutions",
      "solutions director", "vp of solutions", "vp, solutions", "vp solutions",
      "head of applied ai", "director of applied ai", "director, applied ai",
    ],
  } satisfies Record<TargetRole, string[]>,

  /** A title that matches any pre-sales family AND carries one of these markers is a
   *  leadership role ("Director of Sales Engineering", "Solutions Consulting Manager").
   *  "Lead", "staff" and "principal" stay IC: they are senior individual-contributor
   *  levels in most SE ladders. */
  leadershipMarkers: ["director", "head of", "vp", "svp", "avp", "vice president", "manager", "chief"],

  /** Hard location scope: only New York City or remote roles are ever matched. The
   *  editable search profile can narrow this further (e.g. remote only), never widen it. */
  locationScope: {
    /** NYC as ATS boards write it. A match directly after a comma is a state
     *  qualifier ("Albany, New York"), not the city, unless it is "New York, NY". */
    nycTerms: ["new york city", "new york", "nyc", "ny, ny", "brooklyn"],
    remoteTerms: ["remote", "anywhere", "work from home", "wfh", "distributed"],
    /** A remote posting tied to one of these, with no US qualifier, is effectively
     *  located abroad ("Remote - EMEA", Ashby "London" + isRemote). */
    foreignRemoteRegions: [
      "emea", "europe", "eu", "uk", "united kingdom", "england", "london", "ireland", "dublin",
      "germany", "berlin", "munich", "france", "paris", "netherlands", "amsterdam", "spain",
      "madrid", "barcelona", "portugal", "lisbon", "italy", "switzerland", "zurich", "sweden",
      "stockholm", "denmark", "norway", "finland", "poland", "warsaw", "israel", "tel aviv",
      "india", "bangalore", "bengaluru", "apac", "asia", "japan", "tokyo", "singapore",
      "australia", "sydney", "melbourne", "new zealand", "korea", "seoul", "china", "hong kong",
      "canada", "toronto", "vancouver", "montreal", "latam", "latin america", "mexico", "brazil",
      "sao paulo", "argentina", "colombia", "dubai", "uae", "middle east", "africa",
    ],
    usQualifiers: ["us", "usa", "u.s.", "united states", "americas", "amer", "north america", "new york", "nyc"],
  },

  /** Titles containing any of these are never target matches, even if the JD body
   *  mentions target terms (recruiters/legal/marketing that hire or support these roles,
   *  and role families deliberately out of scope). */
  excludeTitles: [
    "recruit", "recruiting", "recruiter", "sourcer", "talent",
    "legal", "counsel", "paralegal",
    "marketing", "brand", "content", "social media", "communications",
    "designer", "design engineer",
    "accountant", "controller", "bookkeep", "payroll", "finance",
    "people partner", "people ops", "office manager", "executive assistant", "events", "event ",
    "product manager", "product management", "forward deployed", "forward-deployed",
  ],

  /** Stage 2-4: resolving discovered names to verified domains and careers boards.
   *  Every guessed or searched domain must pass page verification before it is used. */
  resolve: {
    /** Source articles fetched per company to mine outbound links to its site. */
    maxSourcePages: 3,
    /** Name-derived domains tried (acme.ai, acme.com, getacme.com, ...). */
    maxGuesses: 8,
    /** Careers pages fetched per company while looking for an ATS link. */
    maxCareersPages: 3,
    /** At or above this a domain is used automatically; below it goes to review. */
    autoAcceptConfidence: 0.7,
    /** Weaker verified candidates are still offered in review as one-click promotes. */
    suggestConfidence: 0.35,
    /** Background retries of open no_domain review items per run, and their backoff (days). */
    maxBacklogPerRun: 20,
    retryBackoffDays: [1, 3, 7, 14, 30],
    /** Companies without a readable board are re-checked this often (they often add one after raising). */
    atsRecheckDays: 7,
    maxAtsRechecksPerRun: 25,
    /** Consecutive failed board fetches before the board is treated as moved and re-detected. */
    boardFailureLimit: 3,
    /** Stage 3 search fallback (Brave if BRAVE_SEARCH_API_KEY is set, then Claude) per run. */
    maxSearchLookupsPerRun: 10,
    llmModel: process.env.AJR_RESOLVE_MODEL ?? "claude-opus-5-5",
    /** Hosts that are never a company's own site: news, wires, social, data vendors, investors' tools. */
    nonCompanyHosts: [
      "techcrunch.com", "businesswire.com", "prnewswire.com", "globenewswire.com", "accesswire.com",
      "einpresswire.com", "newswire.com", "prweb.com", "venturebeat.com", "forbes.com", "fortune.com",
      "bloomberg.com", "reuters.com", "wsj.com", "nytimes.com", "theinformation.com", "axios.com",
      "cnbc.com", "theverge.com", "wired.com", "siliconangle.com", "finsmes.com", "tech.eu",
      "sifted.eu", "geekwire.com", "fastcompany.com", "businessinsider.com", "yahoo.com", "msn.com",
      "crunchbase.com", "pitchbook.com", "cbinsights.com", "tracxn.com", "dealroom.co", "wellfound.com",
      "angel.co", "ycombinator.com", "producthunt.com", "linkedin.com", "twitter.com", "x.com",
      "facebook.com", "instagram.com", "youtube.com", "youtu.be", "tiktok.com", "medium.com",
      "substack.com", "github.com", "google.com", "apple.com", "wikipedia.org", "bit.ly", "lnkd.in",
      "t.co", "calendly.com", "hubspot.com", "mailchimp.com", "doubleclick.net", "googletagmanager.com",
      "gstatic.com", "cloudflare.com", "w3.org", "schema.org", "greenhouse.io", "ashbyhq.com",
      "lever.co", "workable.com", "rippling.com",
    ],
  },

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
