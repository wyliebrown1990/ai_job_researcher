import { expect, test, describe } from "bun:test";
import { classifyTitle, matchJob } from "../src/lib/roleMatch.ts";
import { inLocationScope, isNewYorkCity } from "../src/lib/locations.ts";
import type { JobPosting, SearchProfile } from "../src/types.ts";

function job(p: Partial<JobPosting>): JobPosting {
  return { externalId: "x", title: "", location: "New York, NY", url: "", retrievedAt: "2026-08-08T00:00:00Z", ...p };
}

function profile(overrides: Partial<SearchProfile> = {}): SearchProfile {
  return {
    targetRoles: ["applied-ai", "sales-engineer", "solutions-consultant", "se-leadership"],
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

describe("classifyTitle (technical pre-sales families)", () => {
  test.each([
    ["Sales Engineer", "sales-engineer"],
    ["Senior Sales Engineer, Enterprise", "sales-engineer"],
    ["Principal Solutions Engineer", "sales-engineer"],
    ["Lead Solution Engineer - Strategic", "sales-engineer"],
    ["Pre-Sales Engineer", "sales-engineer"],
    ["Customer Engineer, Google Cloud AI", "sales-engineer"],
    ["Solutions Consultant", "solutions-consultant"],
    ["Senior Solution Consultant", "solutions-consultant"],
    ["Solutions Architect, Generative AI", "solutions-consultant"],
    ["Presales Consultant", "solutions-consultant"],
    ["Technical Sales Consultant", "solutions-consultant"],
    ["Applied AI Consultant", "applied-ai"],
    ["Applied AI Architect, Enterprise Tech", "applied-ai"],
    ["Applied AI Solutions Engineer", "applied-ai"],
    ["Generative AI Consultant", "applied-ai"],
    ["Director of Sales Engineering", "se-leadership"],
    ["Director, Solutions Consulting", "se-leadership"],
    ["Sales Engineering Manager", "se-leadership"],
    ["Head of Solutions Engineering", "se-leadership"],
    ["VP, Pre-Sales", "se-leadership"],
    ["Senior Manager, Solutions Architecture", "se-leadership"],
    ["Field CTO", "se-leadership"],
    ["Head of Applied AI", "se-leadership"],
  ])("%s => %s", (title, role) => {
    expect(classifyTitle(title)).toBe(role as ReturnType<typeof classifyTitle>);
  });

  test.each(["Product Manager", "Forward Deployed Engineer", "Partnerships Lead", "Account Executive", "Applied AI Engineer", "Software Engineer"])(
    "%s is out of scope", (title) => expect(classifyTitle(title)).toBeNull(),
  );
});

describe("location scope (NYC or remote only)", () => {
  test.each(["New York, NY", "New York City", "NYC", "New York, New York, United States", "Brooklyn, NY", "San Francisco; New York", "Hybrid - New York", "US-NY-New York"])(
    "%s is New York City", (location) => expect(isNewYorkCity(location)).toBe(true),
  );
  test.each(["Albany, New York", "Rochester, NY", "San Francisco, CA", "Jersey City, NJ"])(
    "%s is not New York City", (location) => expect(isNewYorkCity(location)).toBe(false),
  );

  test("accepts NYC and US-open remote, rejects everything else", () => {
    expect(inLocationScope({ location: "New York, NY" })).toBe(true);
    expect(inLocationScope({ location: "Remote - US" })).toBe(true);
    expect(inLocationScope({ location: "Remote" })).toBe(true);
    expect(inLocationScope({ location: "San Francisco, CA", isRemote: true })).toBe(true);
    expect(inLocationScope({ location: "Remote (US or Canada)" })).toBe(true);
    expect(inLocationScope({ location: "Remote - EMEA; New York" })).toBe(true);
    expect(inLocationScope({ location: "San Francisco, CA" })).toBe(false);
    expect(inLocationScope({ location: "Hybrid - Austin, TX" })).toBe(false);
    expect(inLocationScope({ location: "Remote - EMEA" })).toBe(false);
    expect(inLocationScope({ location: "London", isRemote: true })).toBe(false);
    expect(inLocationScope({ location: "Remote, Canada" })).toBe(false);
    expect(inLocationScope({ location: "" })).toBe(false);
  });

  test("the scope applies even without a profile", () => {
    expect(matchJob(job({ title: "Sales Engineer", location: "Seattle, WA" }))).toBeNull();
    expect(matchJob(job({ title: "Sales Engineer", location: "Remote - US" }))).toMatchObject({ role: "sales-engineer" });
  });
});

describe("matchJob (E1/E3)", () => {
  test("matches a clean sales engineer title on the title only", () => {
    const m = matchJob(job({ title: "Enterprise Sales Engineer", descriptionText: "demos, POCs, technical discovery" }));
    expect(m?.role).toBe("sales-engineer");
    expect(m?.matchedOn).toEqual(["title"]);
  });

  test("IC seniority raises a fit caveat, but leadership titles do not", () => {
    expect(matchJob(job({ title: "Principal Solutions Consultant", descriptionText: "10+ years presales" }))?.fitCaveat).toMatch(/senior/i);
    expect(matchJob(job({ title: "Director of Sales Engineering" }))?.fitCaveat).toBeUndefined();
  });

  test("SE with heavy coding JD gets a coding caveat (E1)", () => {
    const m = matchJob(job({
      title: "Solutions Engineer",
      descriptionText: "Strong React, TypeScript, Node.js, full-stack experience required",
    }));
    expect(m?.role).toBe("sales-engineer");
    expect(m?.fitCaveat).toMatch(/coding depth/i);
  });

  test("product, partnerships and forward-deployed titles never match", () => {
    expect(matchJob(job({ title: "Product Manager, Solutions Engineering" }))).toBeNull();
    expect(matchJob(job({ title: "Forward Deployed Solutions Engineer" }))).toBeNull();
    expect(matchJob(job({ title: "Strategic Partnerships Manager" }))).toBeNull();
  });

  test("excludes non-target titles even when the JD mentions target terms (precision)", () => {
    // A recruiter JD that mentions hiring sales engineers must NOT match.
    expect(matchJob(job({
      title: "Technical Recruiter",
      descriptionText: "You'll hire sales engineers and solutions architects",
    }))).toBeNull();
    expect(matchJob(job({ title: "Solutions Marketing Manager" }))).toBeNull();
    expect(matchJob(job({ title: "Legal Counsel" }))).toBeNull();
  });

  test("non-target role returns null", () => {
    expect(matchJob(job({ title: "Backend Software Engineer", descriptionText: "golang microservices" }))).toBeNull();
  });

  test("respects the active role, location, and experience preferences", () => {
    const p = profile({
      targetRoles: ["solutions-consultant"],
      acceptedLocations: ["New York, NY"],
      remotePreference: "remote-or-location",
      maxExperienceYears: 8,
    });
    expect(matchJob(job({ title: "Solutions Consultant", location: "New York, NY", descriptionText: "6 years experience" }), p)).not.toBeNull();
    expect(matchJob(job({ title: "Sales Engineer", location: "New York, NY" }), p)).toBeNull();
    expect(matchJob(job({ title: "Solutions Consultant", location: "San Francisco", descriptionText: "6 years experience" }), p)).toBeNull();
    expect(matchJob(job({ title: "Solutions Consultant", location: "Remote", isRemote: true, descriptionText: "10 years experience" }), p)).toBeNull();
    // Greenhouse has no remote flag: the location label alone counts as remote.
    expect(matchJob(job({ title: "Solutions Consultant", location: "Remote - US" }), profile({ remotePreference: "remote-only" }))).not.toBeNull();
  });

  test("matches a custom title only in the title, never in the description", () => {
    const p = profile({ targetRoles: [], customTitlePhrases: ["value engineer"] });
    expect(matchJob(job({ title: "Value Engineer", descriptionText: "" }), p)).toMatchObject({
      role: "custom", customTitlePhrase: "value engineer",
    });
    expect(matchJob(job({ title: "Technical Recruiter", descriptionText: "Hiring a value engineer" }), p)).toBeNull();
  });
});
