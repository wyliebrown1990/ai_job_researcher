// Daily loop orchestration (design §2 graph): ingest → plan → refresh/enrich →
// job-scan → verify → rank/digest → persist/deliver. DISCOVER (surfacing brand-new
// candidates from funding news) is the LLM node and is invoked separately; this
// pipeline runs the deterministic refresh + digest over the existing watchlist.

import { Store } from "./db/db.ts";
import { enrichAndScore } from "./lib/enrich.ts";
import { renderDigest, type CompanyDigest } from "./digest.ts";
import { deliver } from "./deliver.ts";
import { resetFetchBudget, fetchesUsed, nowIso } from "./fetchers/http.ts";
import { config } from "./config.ts";
import type { ReviewItem, RoleMatch } from "./types.ts";

export interface RunResult {
  skipped: boolean;
  runDate: string;
  digestPath?: string;
  emailed?: boolean;
  companiesScored?: number;
  fetches?: number;
}

export async function runDaily(
  store: Store,
  opts: { force?: boolean; now?: Date } = {},
): Promise<RunResult> {
  const now = opts.now ?? new Date();
  const runDate = now.toISOString().slice(0, 10);
  resetFetchBudget();

  // Idempotency (design §6): one completed run per calendar day.
  if (!store.beginRun(runDate, nowIso()) && !opts.force) {
    return { skipped: true, runDate };
  }

  // PLAN: refresh the whole active watchlist (bounded by the daily cap).
  const watchlist = store.allCompanies()
    .filter((c) => c.status !== "archived")
    .slice(0, config.limits.maxRefreshPerDay);

  const results: CompanyDigest[] = [];
  const savedRoles: { company: CompanyDigest["company"]; match: RoleMatch }[] = [];
  const profile = store.getSearchProfile();
  for (const c of watchlist) {
    // "New entrant" = recently founded, not merely first-scored (else every company
    // is a new entrant on run one).
    const isNew = c.foundedYear !== undefined && c.foundedYear >= now.getFullYear() - 1;
    const { company, matches, jobs } = await enrichAndScore(c, { isNew, now, profile });
    // Growth remains visible on the company side, while the role queue honors the
    // minimum company signal threshold in the active personal search profile.
    const profileMatches = (company.score?.score ?? 0) >= profile.minCompanyScore ? matches : [];
    // Application decisions belong to individual postings, not the company. Keep
    // scanning every role, but omit deliberately hidden/applied postings from the digest.
    const visibleMatches = profileMatches.filter((match) => {
      const state = store.getRoleState(company.domain, match.job.externalId);
      return !state?.hidden && !state?.applied;
    });
    for (const match of matches) {
      const state = store.getRoleState(company.domain, match.job.externalId);
      if (state?.saved && state.updatedAt.slice(0, 10) === runDate) savedRoles.push({ company, match });
    }

    // VERIFY — evidence hard-gate (C4): a company with no dated source evidence and
    // no live job signal can't be trusted in the main digest → review queue.
    if (company.evidence.length === 0 && matches.length === 0) {
      const item: ReviewItem = {
        domain: company.domain,
        displayName: company.displayName,
        reason: "undated",
        detail: "No dated source evidence and no live roles — needs enrichment before scoring.",
        evidence: [],
        createdAt: nowIso(),
      };
      store.addReviewItem(item);
      if (company.score) company.score.bucket = "review-queue";
    }

    store.upsertCompany(company);
    if (jobs.length) store.replaceCachedJobs(company.domain, jobs);
    store.writeSnapshot(company, runDate, visibleMatches.length);
    if (company.latestFunding) store.appendFundingEvent(company.domain, company.latestFunding);
    results.push({ company, matches: visibleMatches });
  }

  // RANK & DIGEST
  const reviewItems = store.openReviewItems();
  const dueActions = store.applications().filter((application) =>
    application.status !== "closed"
    && application.nextActionAt !== undefined
    && application.nextActionAt <= runDate,
  );
  const markdown = renderDigest({ runDate, companies: results, reviewItems, savedRoles, dueActions, now });

  // PERSIST & DELIVER
  const movers = results.filter((cd) => cd.company.score?.bucket === "top-mover").length;
  const matchCount = results.reduce((n, cd) => n + cd.matches.length, 0);
  const subject = `AI Industry Digest — ${runDate} · ${movers} mover(s), ${matchCount} role(s)`;
  const receipt = await deliver(markdown, runDate, { subject });
  const summary = `${results.length} scored, ${reviewItems.length} in review, ${fetchesUsed()} fetches`;
  store.finishRun(runDate, nowIso(), summary);

  return {
    skipped: false,
    runDate,
    digestPath: receipt.path,
    emailed: receipt.emailed,
    companiesScored: results.length,
    fetches: fetchesUsed(),
  };
}
