import { afterEach, describe, expect, test } from "bun:test";
import { Store } from "../src/db/db.ts";
import type { Company, FundingEvent, JobPosting } from "../src/types.ts";

const stores: Store[] = [];

function store(): Store {
  const value = new Store(":memory:");
  stores.push(value);
  return value;
}

function company(overrides: Partial<Company> = {}): Company {
  return {
    domain: "example.ai",
    displayName: "Example AI",
    aliases: ["Example AI"],
    status: "watching",
    roleWatches: [],
    evidence: [],
    firstSeen: "2026-08-13T00:00:00.000Z",
    lastUpdated: "2026-08-13T00:00:00.000Z",
    sightings: 1,
    ...overrides,
  };
}

function funding(amountUsd?: number): FundingEvent {
  return {
    stage: "seed",
    amountUsd,
    leadInvestors: [],
    otherInvestors: [],
    announcedDate: "2026-08-13",
    evidence: [],
  };
}

function score(value: number, confidence: "medium" | "high") {
  return {
    score: value,
    bucket: "watching" as const,
    confidence,
    components: {
      fundingMomentum: 0.2,
      customerTraction: 0.3,
      hiringVelocity: 0.2,
      productMomentum: 0.2,
      evidenceQuality: 0.1,
    },
    breakdown: {
      fundingMomentum: 6,
      customerTraction: 7.5,
      hiringVelocity: 4,
      productMomentum: 3,
      evidenceQuality: 1,
    },
  };
}

afterEach(() => {
  while (stores.length) stores.pop()!.close();
});

describe("Store personal signal foundation", () => {
  test("persists company research intent separately from company JSON", () => {
    const db = store();
    db.upsertCompany(company());
    db.setPinned("example.ai", true);
    db.setNotes("example.ai", "Ask about the solutions team.");

    expect(db.getCompany("example.ai")).toMatchObject({
      pinned: true,
      notes: "Ask about the solutions team.",
    });
  });

  test("keeps one up-to-date snapshot per company and run date", () => {
    const db = store();
    db.writeSnapshot(company({ score: score(61, "medium") }), "2026-08-13", 2);
    db.writeSnapshot(company({ score: score(64, "high") }), "2026-08-13", 3);

    expect(db.snapshotsFor("example.ai")).toMatchObject([{ runDate: "2026-08-13", score: 64, matchingRolesCount: 3 }]);
  });

  test("deduplicates funding rounds even when the amount is undisclosed", () => {
    const db = store();
    db.appendFundingEvent("example.ai", funding());
    db.appendFundingEvent("example.ai", funding());

    expect(db.fundingHistory("example.ai")).toHaveLength(1);
  });

  test("returns defaults and persists a personal search profile", () => {
    const db = store();
    expect(db.getSearchProfile().targetRoles).toContain("solutions-engineer");

    db.saveSearchProfile({
      targetRoles: ["product-manager"],
      acceptedLocations: ["New York"],
      remotePreference: "remote-or-location",
      includedSectors: ["Agentic AI"],
      excludedKeywords: ["intern"],
      minCompanyScore: 55,
      maxExperienceYears: 8,
    });

    expect(db.getSearchProfile()).toMatchObject({
      targetRoles: ["product-manager"],
      acceptedLocations: ["New York, NY"],
      minCompanyScore: 55,
    });
  });

  test("keeps a role application independent from company state", () => {
    const db = store();
    db.upsertCompany(company({ status: "watching" }));
    db.upsertRoleState("example.ai", "job-1", { saved: true, applied: true });
    const application = db.createApplication({
      domain: "example.ai",
      externalId: "job-1",
      status: "applied",
      notes: "Used GTM resume.",
      nextActionAt: "2026-08-20",
    });

    expect(db.getRoleState("example.ai", "job-1")).toMatchObject({ saved: true, applied: true });
    expect(application).toMatchObject({ status: "applied", notes: "Used GTM resume." });
    expect(db.getCompany("example.ai")?.status).toBe("watching");
  });

  test("lists applications in most recently updated order", () => {
    const db = store();
    db.createApplication({ domain: "example.ai", externalId: "job-1", status: "researching", notes: "First" });
    db.createApplication({ domain: "example.ai", externalId: "job-2", status: "applied", notes: "Second" });
    expect(db.applications().map((application) => application.externalId)).toEqual(["job-2", "job-1"]);
  });

  test("replaces a company's raw current ATS cache without touching another company", () => {
    const db = store();
    const first: JobPosting = {
      externalId: "job-1", title: "Product Manager", location: "New York",
      url: "https://example.ai/jobs/1", retrievedAt: "2026-08-13T10:00:00Z",
    };
    db.replaceCachedJobs("example.ai", [first]);
    db.replaceCachedJobs("other.ai", [{ ...first, externalId: "other-job", url: "https://other.ai/jobs/1" }]);
    db.replaceCachedJobs("example.ai", [{ ...first, externalId: "job-2", title: "Solutions Engineer" }]);
    expect(db.cachedJobs("example.ai").map((job) => job.externalId)).toEqual(["job-2"]);
    expect(db.cachedJobs("other.ai").map((job) => job.externalId)).toEqual(["other-job"]);
  });
});
