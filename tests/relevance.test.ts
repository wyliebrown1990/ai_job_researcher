import { describe, expect, test } from "bun:test";
import { buildDiscoveryContext } from "../src/discover.ts";
import { evaluateRelevance } from "../src/lib/relevance.ts";
import type { Company, SearchProfile } from "../src/types.ts";

function profile(overrides: Partial<SearchProfile> = {}): SearchProfile {
  return {
    targetRoles: ["product-manager"], customTitlePhrases: [], acceptedLocations: [], remotePreference: "any",
    includedSectors: [], sectorPreferenceStrength: "required", businessModelThemes: [],
    preferredStages: [], stagePreferenceStrength: "preferred", preferredTeamSizes: [], teamSizePreferenceStrength: "preferred",
    excludedCompanyDomains: [], equityPriority: "not-a-factor", compensationNote: "", signalInterests: [], searchBrief: "",
    excludedKeywords: [], minCompanyScore: 0, updatedAt: "2026-08-14T00:00:00Z", ...overrides,
  };
}

function company(overrides: Partial<Company> = {}): Company {
  return {
    domain: "example.ai", displayName: "Example", aliases: ["Example"], status: "watching", roleWatches: [], evidence: [],
    firstSeen: "2026-08-14T00:00:00Z", lastUpdated: "2026-08-14T00:00:00Z", sightings: 1, ...overrides,
  };
}

describe("personal relevance", () => {
  test("keeps an unknown preferred stage visible and explains it", () => {
    const result = evaluateRelevance(company(), profile({ preferredStages: ["series-a"] }));
    expect(result).toMatchObject({ included: true, label: "explore" });
    expect(result.reasons.join(" ")).toContain("stage is unknown");
  });

  test("holds an unknown required stage out of the primary queue", () => {
    const result = evaluateRelevance(company(), profile({ preferredStages: ["series-a"], stagePreferenceStrength: "required" }));
    expect(result).toMatchObject({ included: false, label: "outside-criteria" });
    expect(result.reasons[0]).toContain("required company stage is unknown");
  });

  test("never changes a company Growth Score", () => {
    const item = company({ score: undefined });
    evaluateRelevance(item, profile({ excludedCompanyDomains: ["example.ai"] }));
    expect(item.score).toBeUndefined();
  });

  test("builds a bounded, lane-specific discovery context", () => {
    const context = buildDiscoveryContext(profile({
      customTitlePhrases: ["AI deployment lead"], preferredStages: ["seed"], searchBrief: "Customer-facing AI work.",
    }));
    expect(context).toContain("Hard constraints:");
    expect(context).toContain("custom title phrases: AI deployment lead");
    expect(context).toContain("Explore: user brief: Customer-facing AI work.");
  });
});
