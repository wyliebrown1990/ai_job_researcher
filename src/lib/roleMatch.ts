// Role matching (E1/E3): map ATS postings to Wylie's target role families.
// Matches over title AND JD body AND team (title-only matching misses real roles),
// and attaches an honest fit_caveat (title match is not fit).

import type { JobPosting, RoleMatch, TargetRole } from "../types.ts";
import { config } from "../config.ts";

const YEARS_RE = /\b(\d{1,2})\+?\s*(?:years|yrs)\b/i;
const SENIOR_TITLE_RE = /\b(principal|staff|head\s+of|vp|vice\s+president|director|lead)\b/i;
// JDs that lean heavy engineering — a "Solutions/Forward-Deployed" title can hide a
// full-stack coding role that diverges from a GTM-lean profile (E1).
const HEAVY_CODING_RE = /\b(react|typescript|node\.?js|golang|full-?stack|ci\/cd|kubernetes|distributed systems|leetcode)\b/i;

/**
 * Return the best target-role match for a single posting, or null.
 *
 * Deterministic layer = TITLE-first for precision (E3 follow-up). A curated exclusion
 * list drops recruiter/legal/marketing titles outright so passing JD mentions of
 * target terms don't create false positives. Semantic body matching (e.g. an
 * unusually-named role that IS a solutions role) is left to the LLM enrichment node.
 */
export function matchJob(job: JobPosting): RoleMatch | null {
  const title = (job.title ?? "").toLowerCase();
  if (!title) return null;
  if (config.excludeTitles.some((x) => title.includes(x))) return null;

  for (const [role, forms] of Object.entries(config.targetRoles) as [TargetRole, string[]][]) {
    if (forms.some((form) => title.includes(form))) {
      return { job, role, matchScore: 1, matchedOn: ["title"], fitCaveat: buildCaveat(job, role) };
    }
  }
  return null;
}

function buildCaveat(job: JobPosting, role: TargetRole): string | undefined {
  const caveats: string[] = [];
  const hay = `${job.title} ${job.descriptionText ?? ""}`;

  // Check years-of-experience and title seniority independently.
  const yearsMatch = hay.match(YEARS_RE);
  const yrs = yearsMatch ? parseInt(yearsMatch[1]!, 10) : undefined;
  const titleSeniorMatch = job.title.match(SENIOR_TITLE_RE);
  if ((yrs ?? 0) >= config.seniorityCaveatYears || titleSeniorMatch) {
    const label = yrs && yrs >= config.seniorityCaveatYears
      ? `${yrs}+ yrs`
      : (titleSeniorMatch?.[0] ?? "senior");
    caveats.push(`senior role (${label}) — confirm it matches your level`);
  }
  if ((role === "solutions-engineer" || role === "forward-deployed") && HEAVY_CODING_RE.test(hay)) {
    caveats.push("JD leans heavy full-stack coding — confirm coding depth vs a GTM-lean profile");
  }
  return caveats.length ? caveats.join("; ") : undefined;
}

/** Match a whole board; returns matches sorted best-first. */
export function matchBoard(jobs: JobPosting[]): RoleMatch[] {
  return jobs
    .map(matchJob)
    .filter((m): m is RoleMatch => m !== null)
    .sort((a, b) => b.matchScore - a.matchScore);
}
