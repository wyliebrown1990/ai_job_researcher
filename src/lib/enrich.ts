// ENRICH & SCORE + JOB SCAN for a single company (design N5/N6).
// Refreshes the ATS board (open-roles count + hiring-velocity delta + role matches),
// assembles signals, and (re)scores. Funding + judgment sub-scores come from the
// company's stored record (supplied by research/LLM); this node computes the rest.

import type { Company, RoleMatch, Evidence, SearchProfile } from "../types.ts";
import { fetchBoard } from "../fetchers/ats/index.ts";
import { matchBoard } from "./roleMatch.ts";
import { deriveComponents, scoreCompany, type SignalInputs } from "./scoring.ts";
import { nowIso } from "../fetchers/http.ts";

export interface EnrichResult {
  company: Company;
  matches: RoleMatch[];
  /** Newly-matched roles for a role_watch the company was tracking (E1). */
  watchHits: RoleMatch[];
}

function newestEvidenceDate(evidence: Evidence[]): string | undefined {
  if (!evidence.length) return undefined;
  return evidence.map((e) => e.date).sort().at(-1);
}

export async function enrichAndScore(
  input: Company,
  opts: { isNew?: boolean; now?: Date; profile?: SearchProfile } = {},
): Promise<EnrichResult> {
  const now = opts.now ?? new Date();
  const company: Company = { ...input };
  let matches: RoleMatch[] = [];

  // Only advance the hiring-velocity baseline when the calendar day changes, so a
  // same-day re-run doesn't compare a board to itself (hiring velocity measures
  // day-over-day change).
  const prevDate = input.lastUpdated?.slice(0, 10);
  const today = now.toISOString().slice(0, 10);
  const dayAdvanced = prevDate !== today;

  // JOB SCAN — refresh from the ATS JSON (source of truth, E1). Failures are
  // tolerated: keep prior counts rather than crashing the whole run.
  if (company.ats) {
    try {
      const jobs = await fetchBoard(company.ats);
      matches = matchBoard(jobs, opts.profile);
      if (dayAdvanced) company.priorOpenRolesCount = company.openRolesCount;
      company.openRolesCount = jobs.length;
    } catch {
      // leave prior counts intact
    }
  }

  const signals: SignalInputs = {
    fundingEvent: company.latestFunding,
    openRolesCount: company.openRolesCount,
    priorOpenRolesCount: company.priorOpenRolesCount,
    newestEvidenceDate: newestEvidenceDate(company.evidence),
    primarySourceCount: company.evidence.filter((e) => e.primary).length,
    totalSourceCount: company.evidence.length,
    customerTraction: company.judgments?.customerTraction,
    productMomentum: company.judgments?.productMomentum,
  };

  const components = deriveComponents(signals, now);
  const unresolved = !company.domain;
  company.priorScore = company.score?.score;
  company.score = scoreCompany(components, { isNew: opts.isNew, unresolved });
  company.lastUpdated = nowIso();

  const watchHits = matches.filter((m) => company.roleWatches.includes(m.role));
  return { company, matches, watchHits };
}
