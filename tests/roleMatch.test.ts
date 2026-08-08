import { expect, test, describe } from "bun:test";
import { matchJob } from "../src/lib/roleMatch.ts";
import type { JobPosting } from "../src/types.ts";

function job(p: Partial<JobPosting>): JobPosting {
  return { externalId: "x", title: "", location: "", url: "", retrievedAt: "2026-08-08T00:00:00Z", ...p };
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
});
