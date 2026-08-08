// Seed loader: turns data/seed.json into watchlist records + review items.
// Used to bootstrap the watchlist; the LLM DISCOVER node appends to it over time.

import { readFileSync } from "node:fs";
import type { Company, ReviewItem } from "./types.ts";
import { companyKey, mergeAliases } from "./lib/identity.ts";
import { nowIso } from "./fetchers/http.ts";
import { Store } from "./db/db.ts";

interface SeedFile {
  companies?: Partial<Company>[];
  review?: Partial<ReviewItem>[];
}

function toCompany(p: Partial<Company>, now: string): Company | null {
  const key = companyKey(p.domain);
  if (!key || !p.displayName) return null; // no canonical key => not a watchlist entry (E4)
  return {
    domain: key,
    displayName: p.displayName,
    aliases: mergeAliases([p.displayName], p.aliases ?? []),
    description: p.description,
    hq: p.hq,
    foundedYear: p.foundedYear,
    category: p.category,
    status: p.status ?? "watching",
    latestFunding: p.latestFunding,
    totalRaisedUsd: p.totalRaisedUsd,
    ats: p.ats,
    openRolesCount: p.openRolesCount,
    priorOpenRolesCount: p.priorOpenRolesCount,
    score: p.score,
    judgments: p.judgments,
    roleWatches: p.roleWatches ?? [],
    evidence: p.evidence ?? [],
    firstSeen: now,
    lastUpdated: now,
    sightings: 1,
  };
}

export function loadSeed(store: Store, path = "data/seed.json"): { companies: number; review: number } {
  const seed = JSON.parse(readFileSync(path, "utf8")) as SeedFile;
  const now = nowIso();
  let companies = 0;
  let review = 0;

  for (const p of seed.companies ?? []) {
    const existing = p.domain ? store.getCompany(companyKey(p.domain) ?? "") : null;
    const c = toCompany(p, now);
    if (!c) continue;
    if (existing) {
      // Refresh, don't duplicate (E4): merge aliases, keep firstSeen.
      c.firstSeen = existing.firstSeen;
      c.aliases = mergeAliases(existing.aliases, c.aliases);
      c.sightings = existing.sightings + 1;
    }
    store.upsertCompany(c);
    companies++;
  }

  const openReview = store.openReviewItems();
  for (const r of seed.review ?? []) {
    if (!r.displayName || !r.reason) continue;
    if (openReview.some((o) => o.displayName === r.displayName && o.reason === r.reason)) continue;
    store.addReviewItem({
      domain: r.domain,
      displayName: r.displayName,
      reason: r.reason,
      detail: r.detail ?? "",
      evidence: r.evidence ?? [],
      createdAt: now,
    });
    review++;
  }
  return { companies, review };
}
