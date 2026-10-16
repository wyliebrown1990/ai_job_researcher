// Resolution orchestration: stages 2-4 between discovery and the daily refresh.
//
//   discover (LLM, news) → resolveCandidates (domains) → ingest (pure rules)
//     → resolveCareersFor (job boards) → daily refresh
//   runMaintenance: retries the no_domain backlog and re-checks companies without a
//   readable board, on a backoff, so the watchlist heals without manual work.
//
// Network access is injected (ResolveDeps) so every stage is testable offline.

import { config } from "../config.ts";
import { fetchBoard } from "../fetchers/ats/index.ts";
import { FetchBudgetError, fetchPage, nowIso } from "../fetchers/http.ts";
import { companyKey } from "../lib/identity.ts";
import type { Store } from "../db/db.ts";
import type { Candidate, Company, DomainCandidateSummary, ReviewItem } from "../types.ts";
import { findCareers, type BoardFetcher, type CareersResult } from "./careers.ts";
import { hostMatchesName, OTHER_TITLE, resolveDomain, verifyDomain, type PageFetcher, type ResolveInput, type SearchHit, type VerifiedCandidate } from "./domain.ts";
import { configuredSearch } from "./search.ts";

export interface ResolveDeps {
  fetchPage: PageFetcher;
  fetchBoard: BoardFetcher;
  search?: (input: ResolveInput) => Promise<SearchHit[]>;
}

export function liveResolveDeps(): ResolveDeps {
  return { fetchPage, fetchBoard, search: configuredSearch() };
}

const DAY_MS = 86_400_000;

function summaries(candidates: VerifiedCandidate[]): DomainCandidateSummary[] {
  return candidates.map(({ domain, confidence, method, evidenceUrl }) => ({ domain, confidence, method, evidenceUrl }));
}

function candidateInput(c: Candidate): ResolveInput {
  return {
    displayName: c.displayName,
    description: c.description,
    category: c.category,
    website: c.website,
    websiteSourceUrl: c.websiteSourceUrl,
    sources: c.sources ?? [],
  };
}

export interface CandidateResolutionSummary {
  verified: number;
  resolved: number;
  unresolved: number;
}

/**
 * Stage 2/3 for fresh discovery output: give each candidate a verified domain where
 * possible. Mutates candidates (domain + resolution) so ingest can stay pure.
 */
export async function resolveCandidates(store: Store, candidates: Candidate[], deps: ResolveDeps): Promise<CandidateResolutionSummary> {
  const summary: CandidateResolutionSummary = { verified: 0, resolved: 0, unresolved: 0 };
  for (const c of candidates) {
    try {
      // A domain from discovery is kept when its page names the company, when the domain
      // is built from the name (JS-rendered sites can hide the name), or when the page
      // can't be read at all (bot walls) — but dropped when a reachable page is clearly
      // someone else's.
      const provided = companyKey(c.domain);
      if (provided) {
        const check = await verifyDomain(provided, "provided", candidateInput(c), deps.fetchPage, c.websiteSourceUrl);
        if (!check || check.confidence >= config.resolve.suggestConfidence || (hostMatchesName(check.domain, c.displayName) && !check.signals.includes(OTHER_TITLE))) {
          c.domain = check?.domain ?? provided;
          c.resolution = { method: "provided", confidence: check?.confidence ?? 0, evidenceUrl: c.websiteSourceUrl, candidates: check ? summaries([check]) : [] };
          summary.verified++;
          continue;
        }
        c.domain = undefined;
      }
      const result = await resolveDomain(candidateInput(c), { fetchPage: deps.fetchPage, search: deps.search, cachedDomain: store.getNameDomain(c.displayName) });
      c.resolution = { method: result.method, confidence: result.confidence, evidenceUrl: result.evidenceUrl, candidates: summaries(result.candidates) };
      if (result.domain) {
        c.domain = result.domain;
        store.rememberNameDomain(c.displayName, result.domain, result.method ?? "guess", result.confidence);
        summary.resolved++;
      } else {
        summary.unresolved++;
      }
    } catch (error) {
      if (error instanceof FetchBudgetError) break;
      summary.unresolved++;
    }
  }
  return summary;
}

/** Record a careers lookup on the company; returns true when a readable board was found. */
export function applyCareers(store: Store, company: Company, result: CareersResult, now = nowIso()): boolean {
  company.atsCheckedAt = now;
  company.careersUrl = result.careersUrl ?? company.careersUrl;
  company.unsupportedAts = result.unsupportedAts;
  if (result.ats) {
    company.ats = result.ats;
    company.atsSource = result.source;
    company.atsDetection = "available";
    company.atsFailures = 0;
    company.openRolesCount = result.jobs?.length ?? company.openRolesCount;
    store.upsertCompany(company);
    if (result.jobs?.length) store.replaceCachedJobs(company.domain, result.jobs);
    return true;
  }
  company.atsDetection = "not-detected";
  store.upsertCompany(company);
  return false;
}

/** Stage 2b for specific companies (new from discovery, promoted, or manually added). */
export async function resolveCareersFor(store: Store, domains: string[], deps: ResolveDeps): Promise<number> {
  let found = 0;
  for (const domain of domains) {
    const company = store.getCompany(domain);
    if (!company || company.ats) continue;
    try {
      if (applyCareers(store, company, await findCareers(domain, company.displayName, deps))) found++;
    } catch (error) {
      if (error instanceof FetchBudgetError) break;
    }
  }
  return found;
}

function retryDue(item: ReviewItem, now: Date): boolean {
  const attempts = item.resolveAttempts ?? 0;
  const backoff = config.resolve.retryBackoffDays;
  if (attempts >= backoff.length + 1) return false;
  if (!item.lastResolveAt) return true;
  return now.getTime() - Date.parse(item.lastResolveAt) >= backoff[Math.min(attempts - 1, backoff.length - 1)]! * DAY_MS;
}

function atsRecheckDue(company: Company, now: Date): boolean {
  if (company.status === "archived" || company.ats || company.unsupportedAts) return false;
  return !company.atsCheckedAt || now.getTime() - Date.parse(company.atsCheckedAt) >= config.resolve.atsRecheckDays * DAY_MS;
}

export interface MaintenanceSummary {
  backlogTried: number;
  backlogResolved: number;
  atsChecked: number;
  atsFound: number;
}

/** Stage 4: heal the backlog and stale boards, bounded per run. */
export async function runMaintenance(store: Store, deps: ResolveDeps, now = new Date()): Promise<MaintenanceSummary> {
  const summary: MaintenanceSummary = { backlogTried: 0, backlogResolved: 0, atsChecked: 0, atsFound: 0 };
  const nowStamp = now.toISOString();
  try {
    const due = store.openReviewRows()
      .filter((row) => row.item.reason === "no_domain" && retryDue(row.item, now))
      .slice(0, config.resolve.maxBacklogPerRun);
    for (const { id, item } of due) {
      summary.backlogTried++;
      const input: ResolveInput = {
        displayName: item.displayName,
        description: item.context?.description ?? item.evidence[0]?.claim,
        category: item.context?.category,
        sources: item.evidence.map((e) => ({ url: e.sourceUrl })),
      };
      const result = await resolveDomain(input, { fetchPage: deps.fetchPage, search: deps.search, cachedDomain: store.getNameDomain(item.displayName) });
      if (result.domain) {
        if (!store.getCompany(result.domain)) {
          store.upsertCompany({
            domain: result.domain, displayName: item.displayName, aliases: [item.displayName],
            description: input.description, category: input.category, status: "watching", roleWatches: [],
            evidence: item.evidence, firstSeen: nowStamp, lastUpdated: nowStamp, sightings: item.sightings ?? 1,
            domainSource: { method: result.method ?? "guess", confidence: result.confidence, evidenceUrl: result.evidenceUrl },
          });
        }
        store.rememberNameDomain(item.displayName, result.domain, result.method ?? "guess", result.confidence);
        store.resolveReviewItem(id);
        summary.backlogResolved++;
        continue;
      }
      const candidates = summaries(result.candidates);
      store.updateReviewItem(id, {
        ...item,
        candidates: candidates.length ? candidates : item.candidates,
        resolveAttempts: (item.resolveAttempts ?? 0) + 1,
        lastResolveAt: nowStamp,
      });
    }

    const stale = store.allCompanies().filter((company) => atsRecheckDue(company, now)).slice(0, config.resolve.maxAtsRechecksPerRun);
    for (const company of stale) {
      summary.atsChecked++;
      if (applyCareers(store, company, await findCareers(company.domain, company.displayName, deps), nowStamp)) summary.atsFound++;
    }
  } catch (error) {
    if (!(error instanceof FetchBudgetError)) throw error;
  }
  return summary;
}
