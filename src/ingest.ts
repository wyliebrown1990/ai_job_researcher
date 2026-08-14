// Ingest LLM candidates into the watchlist (deterministic, pure, testable).
// This is the boundary that protects the watchlist from the LLM: it applies the
// domain-identity rule (E4), the rumor≠round rule (E5), and the evidence gate (C4).
// No network, no LLM — just rules over structured input.

import type { Candidate, Company, CompanySearchFacts, Evidence, FundingEvent, ReviewItem, TeamSizeBand } from "./types.ts";
import { companyKey, mergeAliases } from "./lib/identity.ts";
import { classifyFundingClaim, parseStage, parseUsdAmount } from "./lib/fundingLanguage.ts";
import { config } from "./config.ts";
import type { Store } from "./db/db.ts";

export interface IngestSummary {
  added: number;
  refreshed: number;
  reviewed: number;
  /** Domains of newly-added companies whose ATS board still needs detecting. */
  newDomains: string[];
}

function toEvidence(sources: Candidate["sources"], fallbackClaim: string): Evidence[] {
  return (sources ?? [])
    .filter((s) => s.url)
    .map((s) => ({
      claim: fallbackClaim,
      sourceUrl: s.url,
      date: s.date ?? "",
      primary: Boolean(s.primary),
    }));
}

function buildFundingEvent(f: NonNullable<Candidate["funding"]>, evidence: Evidence[]): FundingEvent {
  const stage = parseStage(f.stageText ?? f.claimText);
  const amountUsd = parseUsdAmount(f.amountText ?? f.claimText);
  const valuationUsd = f.valuationText ? parseUsdAmount(f.valuationText) : undefined;
  return {
    stage,
    amountUsd,
    valuationUsd,
    leadInvestors: f.leadInvestors ?? [],
    otherInvestors: f.otherInvestors ?? [],
    announcedDate: f.announcedDate ?? evidence.map((e) => e.date).filter(Boolean).sort().at(-1) ?? "",
    evidence,
  };
}

function verifiedFitFacts(candidate: Candidate): CompanySearchFacts | undefined {
  const facts = candidate.fitFacts;
  if (!facts?.sourceUrls?.length) return undefined;
  const datedSources = new Set(candidate.sources.filter((source) => source.url && source.date).map((source) => source.url));
  if (!facts.sourceUrls.some((url) => datedSources.has(url))) return undefined;
  const teamSizes: TeamSizeBand[] = ["1-10", "11-50", "51-200", "201-1000", "1000-plus"];
  const teamSize = teamSizes.includes(facts.teamSize as TeamSizeBand) ? facts.teamSize : undefined;
  const businessModelTags = (facts.businessModelTags ?? []).filter((tag) => typeof tag === "string" && tag.trim()).map((tag) => tag.trim()).slice(0, 12);
  return { teamSize, businessModelTags, equityMentioned: Boolean(facts.equityMentioned) };
}

export function ingestCandidates(
  store: Store,
  candidates: Candidate[],
  opts: { now?: Date; cap?: number } = {},
): IngestSummary {
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();
  const cap = opts.cap ?? config.limits.maxNewCandidatesPerDay;
  const summary: IngestSummary = { added: 0, refreshed: 0, reviewed: 0, newDomains: [] };

  for (const c of candidates) {
    const key = companyKey(c.domain);
    const evidence = toEvidence(c.sources, c.description ?? c.displayName);

    // E4: no resolvable domain → review queue, never a guessed watchlist entry.
    if (!key) {
      store.addReviewItem(reviewItem(c, "no_domain",
        "No resolvable company domain — resolve it before adding to the watchlist.", evidence, nowIso));
      summary.reviewed++;
      continue;
    }

    // E5: classify funding language. A rumor is never a funding event.
    let fundingEvent: FundingEvent | undefined;
    if (c.funding) {
      const kind = classifyFundingClaim(c.funding.claimText);
      if (kind === "event") {
        fundingEvent = buildFundingEvent(c.funding, evidence);
      } else if (kind === "rumor") {
        store.addReviewItem(reviewItem(c, "rumored_unconfirmed",
          `Funding is a rumor, not a closed round: "${c.funding.claimText}". Promote if it closes with a dated source.`,
          evidence, nowIso));
        summary.reviewed++;
        // company itself may still be tracked below (without a funding event)
      }
    }

    const existing = store.getCompany(key);
    const fitFacts = verifiedFitFacts(c);
    if (existing) {
      // E4: refresh, don't duplicate.
      existing.aliases = mergeAliases(existing.aliases, [c.displayName]);
      existing.evidence = dedupeEvidence([...existing.evidence, ...evidence]);
      existing.sightings += 1;
      existing.lastUpdated = nowIso;
      if (fundingEvent && isNewerFunding(fundingEvent, existing.latestFunding)) {
        existing.latestFunding = fundingEvent;
        store.appendFundingEvent(key, fundingEvent);
      }
      existing.judgments = { ...existing.judgments, ...c.judgments };
      if (fitFacts) existing.searchFacts = { ...existing.searchFacts, ...fitFacts, businessModelTags: fitFacts.businessModelTags };
      if (c.description && !existing.description) existing.description = c.description;
      store.upsertCompany(existing);
      summary.refreshed++;
      continue;
    }

    if (summary.added >= cap) {
      // Daily discovery funnel is bounded (design §6): defer surplus to the review queue.
      store.addReviewItem(reviewItem(c, "hype_only",
        "Deferred: daily new-candidate cap reached. Re-run discovery tomorrow to ingest.", evidence, nowIso));
      summary.reviewed++;
      continue;
    }

    const company: Company = {
      domain: key,
      displayName: c.displayName,
      aliases: mergeAliases([c.displayName], []),
      description: c.description,
      hq: c.hq,
      foundedYear: c.foundedYear,
      category: c.category,
      status: "watching",
      latestFunding: fundingEvent,
      judgments: c.judgments,
      searchFacts: fitFacts,
      roleWatches: [],
      evidence,
      firstSeen: nowIso,
      lastUpdated: nowIso,
      sightings: 1,
    };
    store.upsertCompany(company);
    if (fundingEvent) store.appendFundingEvent(key, fundingEvent);
    summary.added++;
    summary.newDomains.push(key);
  }

  return summary;
}

function reviewItem(c: Candidate, reason: ReviewItem["reason"], detail: string, evidence: Evidence[], createdAt: string): ReviewItem {
  return { domain: companyKey(c.domain) ?? undefined, displayName: c.displayName, reason, detail, evidence, createdAt };
}

function isNewerFunding(a: FundingEvent, b?: FundingEvent): boolean {
  if (!b) return true;
  return (a.announcedDate ?? "") > (b.announcedDate ?? "");
}

function dedupeEvidence(items: Evidence[]): Evidence[] {
  const seen = new Set<string>();
  return items.filter((e) => {
    if (seen.has(e.sourceUrl)) return false;
    seen.add(e.sourceUrl);
    return true;
  });
}
