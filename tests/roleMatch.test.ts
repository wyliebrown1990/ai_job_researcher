import { expect, test, describe } from "bun:test";
import { matchJob } from "../src/lib/roleMatch.ts";
import type { JobPosting, SearchProfile } from "../src/types.ts";

function job(p: Partial<JobPosting>): JobPosting {
  return { externalId: "x", title: "", location: "", url: "", retrievedAt: "2026-08-08T00:00:00Z", ...p };
}

function profile(overrides: Partial<SearchProfile> = {}): SearchProfile {
  return {
    targetRoles: ["solutions-engineer", "sales-engineer", "product-manager", "partnerships", "forward-deployed"],
    customTitlePhrases: [],
    acceptedLocations: [],
    remotePreference: "any",
    includedSectors: [],
    sectorPreferenceStrength: "required",
    businessModelThemes: [],
    preferredStages: [],
    stagePreferenceStrength: "preferred",
    preferredTeamSizes: [],
    teamSizePreferenceStrength: "preferred",
    excludedCompanyDomains: [],
    equityPriority: "not-a-factor",
    compensationNote: "",
    signalInterests: [],
    searchBrief: "",
    excludedKeywords: [],
    minCompanyScore: 0,
    updatedAt: "2026-08-13T00:00:00Z",
    ...overrides,
  };
}

describe("matchJob (E1/E3)", () => {
  test("matches a clean partnerships title", () => {
    const m = matchJob(job({ title: "Amazon GTM Partnership, Startups", descriptionText: "co-selling, 8+ years experience" }));
    expect(m?.role).toBe("partnerships");
    expect(m?.matchedOn).toContain("title");
  });

  test("seniority raises a fit caveat", () => {
    const m = matchJob(job({ title: "Partnerships Lead", descriptionText: "10+ years partnerships" }));
    expect(m?.fitCaveat).toMatch(/senior/i);
  });

  test("FDE with heavy coding JD gets a coding caveat (E1)", () => {
    const m = matchJob(job({
      title: "Forward Deployed Engineer",
      descriptionText: "Strong React, TypeScript, Node.js, full-stack experience required",
    }));
    expect(m?.role).toBe("forward-deployed");
    expect(m?.fitCaveat).toMatch(/coding depth/i);
  });

  test("curated SE-equivalent titles match (Applied AI Architect => solutions)", () => {
    const m = matchJob(job({ title: "Applied AI Architect, Enterprise Tech" }));
    expect(m?.role).toBe("solutions-engineer");
    expect(m?.matchedOn).toEqual(["title"]);
  });

  test("excludes non-target titles even when the JD mentions target terms (precision)", () => {
    // A recruiter JD that mentions hiring PMs and sales engineers must NOT match.
    expect(matchJob(job({
      title: "Technical Recruiter",
      descriptionText: "You'll hire product managers, sales engineers, and solutions architects",
    }))).toBeNull();
    expect(matchJob(job({ title: "Product Marketing Manager" }))).toBeNull();
    expect(matchJob(job({ title: "Legal Counsel" }))).toBeNull();
  });

  test("non-target role returns null", () => {
    expect(matchJob(job({ title: "Backend Software Engineer", descriptionText: "golang microservices" }))).toBeNull();
  });

  test("respects the active role, location, and experience preferences", () => {
    const p = profile({
      targetRoles: ["product-manager"],
      acceptedLocations: ["New York"],
      remotePreference: "remote-or-location",
      maxExperienceYears: 8,
    });
    expect(matchJob(job({ title: "Product Manager", location: "New York, NY", descriptionText: "6 years experience" }), p)).not.toBeNull();
    expect(matchJob(job({ title: "Solutions Architect", location: "New York, NY" }), p)).toBeNull();
    expect(matchJob(job({ title: "Product Manager", location: "San Francisco", descriptionText: "6 years experience" }), p)).toBeNull();
    expect(matchJob(job({ title: "Product Manager", location: "Remote", isRemote: true, descriptionText: "10 years experience" }), p)).toBeNull();
  });

  test("matches a custom title only in the title, never in the description", () => {
    const p = profile({ targetRoles: [], customTitlePhrases: ["deployment strategist"] });
    expect(matchJob(job({ title: "Deployment Strategist", descriptionText: "" }), p)).toMatchObject({
      role: "custom", customTitlePhrase: "deployment strategist",
    });
    expect(matchJob(job({ title: "Technical Recruiter", descriptionText: "Hiring a deployment strategist" }), p)).toBeNull();
  });
});
