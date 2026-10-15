// Role matching (E1/E3): map ATS postings to Wylie's technical pre-sales role families.
// Matches curated role forms against titles only, and attaches an honest fit_caveat
// (title match is not fit). Description matching is intentionally excluded because
// it created high-volume false positives on live ATS boards.

import type { JobPosting, RoleMatch, SearchProfile, TargetRole } from "../types.ts";
import { config } from "../config.ts";
import { inLocationScope, isRemoteJob, matchesSelectedLocation } from "./locations.ts";

const YEARS_RE = /\b(\d{1,2})\+?\s*(?:years|yrs)\b/i;
const SENIOR_TITLE_RE = /\b(principal|staff|head\s+of|vp|vice\s+president|director|lead)\b/i;
// JDs that lean heavy engineering — a "Solutions Engineer" title can hide a
// full-stack coding role that diverges from a GTM-lean profile (E1).
const HEAVY_CODING_RE = /\b(react|typescript|node\.?js|golang|full-?stack|ci\/cd|kubernetes|distributed systems|leetcode)\b/i;
const LEADERSHIP_RE = new RegExp(`\\b(${config.leadershipMarkers.join("|")})\\b`, "i");

/**
 * Return the best target-role match for a single posting, or null.
 *
 * Deterministic layer = TITLE-first for precision (E3 follow-up). A curated exclusion
 * list drops recruiter/legal/marketing titles outright so passing JD mentions of
 * target terms don't create false positives. Semantic body matching (e.g. an
 * unusually-named role that IS a solutions role) is left to the LLM enrichment node.
 */
export function matchJob(job: JobPosting, profile?: SearchProfile): RoleMatch | null {
  const title = (job.title ?? "").toLowerCase();
  if (!title) return null;
  if (config.excludeTitles.some((x) => title.includes(x))) return null;
  if (profile?.excludedKeywords.some((keyword) => title.includes(keyword.toLowerCase()))) return null;
  if (!inLocationScope(job)) return null;
  if (!matchesLocationPreference(job, profile)) return null;
  if (!matchesExperiencePreference(job, profile)) return null;

  const customTitlePhrase = profile?.customTitlePhrases.find((phrase) => title.includes(phrase.toLowerCase()));
  if (customTitlePhrase) {
    return { job, role: "custom", customTitlePhrase, matchScore: 1, matchedOn: ["title"], fitCaveat: buildCaveat(job, "custom") };
  }

  const role = classifyTitle(title);
  if (!role || (profile && !profile.targetRoles.includes(role))) return null;
  return { job, role, matchScore: 1, matchedOn: ["title"], fitCaveat: buildCaveat(job, role) };
}

/** First family whose title form matches; a pre-sales title with a leadership
 *  marker ("Director of Sales Engineering") is promoted to se-leadership. */
export function classifyTitle(title: string): TargetRole | null {
  const lower = title.toLowerCase();
  for (const [role, forms] of Object.entries(config.targetRoles) as [TargetRole, readonly string[]][]) {
    if (forms.some((form) => lower.includes(form))) return LEADERSHIP_RE.test(lower) ? "se-leadership" : role;
  }
  return null;
}

function matchesLocationPreference(job: JobPosting, profile?: SearchProfile): boolean {
  if (!profile || profile.remotePreference === "any") return true;
  const hasAcceptedLocation = profile.acceptedLocations.some((location) => matchesSelectedLocation(job.location, location));
  if (profile.remotePreference === "remote-only") return isRemoteJob(job);
  if (profile.remotePreference === "remote-or-location") return isRemoteJob(job) || hasAcceptedLocation;
  return hasAcceptedLocation;
}

function matchesExperiencePreference(job: JobPosting, profile?: SearchProfile): boolean {
  if (!profile?.maxExperienceYears) return true;
  const years = `${job.title} ${job.descriptionText ?? ""}`.match(YEARS_RE)?.[1];
  return !years || parseInt(years, 10) <= profile.maxExperienceYears;
}

function buildCaveat(job: JobPosting, role: TargetRole | "custom"): string | undefined {
  const caveats: string[] = [];
  const hay = `${job.title} ${job.descriptionText ?? ""}`;

  // Check years-of-experience and title seniority independently.
  const yearsMatch = hay.match(YEARS_RE);
  const yrs = yearsMatch ? parseInt(yearsMatch[1]!, 10) : undefined;
  // Leadership roles are an explicit target, so their title alone isn't a caveat.
  const titleSeniorMatch = role === "se-leadership" ? null : job.title.match(SENIOR_TITLE_RE);
  if ((yrs ?? 0) >= config.seniorityCaveatYears || titleSeniorMatch) {
    const label = yrs && yrs >= config.seniorityCaveatYears
      ? `${yrs}+ yrs`
      : (titleSeniorMatch?.[0] ?? "senior");
    caveats.push(`senior role (${label}) — confirm it matches your level`);
  }
  if ((role === "sales-engineer" || role === "applied-ai") && HEAVY_CODING_RE.test(hay)) {
    caveats.push("JD leans heavy full-stack coding — confirm coding depth vs a GTM-lean profile");
  }
  return caveats.length ? caveats.join("; ") : undefined;
}

/** Match a whole board; returns matches sorted best-first. */
export function matchBoard(jobs: JobPosting[], profile?: SearchProfile): RoleMatch[] {
  return jobs
    .map((job) => matchJob(job, profile))
    .filter((m): m is RoleMatch => m !== null)
    .sort((a, b) => b.matchScore - a.matchScore);
}
