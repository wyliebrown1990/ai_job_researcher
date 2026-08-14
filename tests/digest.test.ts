import { expect, test, describe } from "bun:test";
import { renderDigest, type CompanyDigest } from "../src/digest.ts";
import { deriveComponents, scoreCompany } from "../src/lib/scoring.ts";
import type { Company, ReviewItem } from "../src/types.ts";

const NOW = new Date("2026-08-08T12:00:00Z");

function company(over: Partial<Company>): Company {
  return {
    domain: "example.com", displayName: "Example", aliases: ["Example"],
    status: "watching", roleWatches: [], evidence: [],
    firstSeen: "2026-08-08T00:00:00Z", lastUpdated: "2026-08-08T00:00:00Z", sightings: 1,
    ...over,
  };
}

describe("renderDigest", () => {
  test("places a strong company in Top Movers and a funded-unproven one in Notable", () => {
    const mover = company({
      domain: "happyrobot.ai", displayName: "HappyRobot",
      latestFunding: { stage: "series-c", amountUsd: 150e6, leadInvestors: ["Prysm"], otherInvestors: [], announcedDate: "2026-08-04", evidence: [] },
      evidence: [{ claim: "Series C", sourceUrl: "https://businesswire.com/x", date: "2026-08-04", primary: true }],
    });
    mover.score = scoreCompany(deriveComponents({
      fundingEvent: mover.latestFunding, openRolesCount: 30,
      customerTraction: 0.85, productMomentum: 0.8,
      newestEvidenceDate: "2026-08-04", primarySourceCount: 1, totalSourceCount: 1,
    }, NOW));

    const notable = company({
      domain: "june.example", displayName: "Junelike",
      latestFunding: { stage: "pre-seed", amountUsd: 20e6, leadInvestors: ["TIME"], otherInvestors: [], announcedDate: "2026-08-07", evidence: [] },
      evidence: [{ claim: "pre-seed", sourceUrl: "https://techcrunch.com/x", date: "2026-08-07", primary: false }],
    });
    notable.score = scoreCompany(deriveComponents({
      fundingEvent: notable.latestFunding, openRolesCount: 1,
      customerTraction: 0.05, productMomentum: 0.4,
      newestEvidenceDate: "2026-08-07", primarySourceCount: 0, totalSourceCount: 1,
    }, NOW));

    const companies: CompanyDigest[] = [{ company: mover, matches: [] }, { company: notable, matches: [] }];
    const review: ReviewItem[] = [{ displayName: "June AI", reason: "no_domain", detail: "no domain", evidence: [], createdAt: NOW.toISOString() }];
    const md = renderDigest({ runDate: "2026-08-08", companies, reviewItems: review, now: NOW });

    expect(mover.score.bucket).toBe("top-mover");
    expect(notable.score.bucket).toBe("notable-unproven");

    // Slice each section and assert the right company lands in it. Note: a company
    // with a recent round appears in BOTH the Funding section AND its bucket section,
    // so we check membership per-section rather than by first-occurrence.
    const sliceSection = (name: string) => {
      const start = md.indexOf(`## ${name}`);
      const rest = md.slice(start + 1);
      const nextRel = rest.indexOf("\n## ");
      return nextRel === -1 ? md.slice(start) : md.slice(start, start + 1 + nextRel);
    };
    expect(sliceSection("Top movers")).toContain("HappyRobot");
    expect(sliceSection("Notable but unproven")).toContain("Junelike");
    // Junelike raised 2 days ago → also shows in the Funding section (correct).
    expect(sliceSection("Funding in the last")).toContain("Junelike");
    expect(sliceSection("Review queue")).toContain("[no_domain]** June AI");
    expect(md).toContain("dated source"); // the evidence-gate footer
  });

  test("empty watchlist still renders all sections", () => {
    const md = renderDigest({ runDate: "2026-08-08", companies: [], reviewItems: [], now: NOW });
    for (const h of ["Industry pulse", "New entrants", "Top movers", "Funding in the last", "Notable but unproven", "Roles for you", "Review queue"]) {
      expect(md).toContain(h);
    }
  });

  test("only adds the saved roles and due actions section when there is work to surface", () => {
    const match = {
      role: "product-manager" as const, matchScore: 1, matchedOn: ["title" as const],
      job: { externalId: "pm-1", title: "Product Manager", location: "New York", url: "https://example.com/jobs/pm-1", retrievedAt: NOW.toISOString() },
    };
    const md = renderDigest({
      runDate: "2026-08-08", companies: [], reviewItems: [], now: NOW,
      savedRoles: [{ company: company({}), match }],
      dueActions: [{ id: 1, domain: "example.com", externalId: "pm-2", status: "networking", notes: "Send a concise follow-up.", nextActionAt: "2026-08-08", createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() }],
    });
    expect(md).toContain("## Saved roles & due actions");
    expect(md).toContain("Saved: [Product Manager]");
    expect(md).toContain("Due 2026-08-08");
  });

  test("keeps Following concise by omitting unchanged pinned companies", () => {
    const unchanged = company({ domain: "quiet.example", displayName: "Quiet", pinned: true });
    const changed = company({
      domain: "moving.example", displayName: "Moving", pinned: true, priorOpenRolesCount: 2, openRolesCount: 5,
    });
    const md = renderDigest({
      runDate: "2026-08-08",
      companies: [{ company: unchanged, matches: [] }, { company: changed, matches: [] }],
      reviewItems: [], now: NOW,
    });
    const section = md.slice(md.indexOf("## Following"), md.indexOf("## Roles for you"));
    expect(section).toContain("Moving");
    expect(section).not.toContain("Quiet");
  });

  test("orders roles by personal fit without changing their Growth Score", () => {
    const growthFirst = company({ domain: "growth.example", displayName: "Growth first" });
    growthFirst.score = scoreCompany(deriveComponents({ openRolesCount: 30 }, NOW));
    const fitFirst = company({ domain: "fit.example", displayName: "Fit first" });
    fitFirst.score = scoreCompany(deriveComponents({ openRolesCount: 1 }, NOW));
    const role = (title: string, relevance: number) => ({
      role: "product-manager" as const, matchScore: 1, matchedOn: ["title" as const], relevance: { included: true, score: relevance, label: "match" as const, reasons: ["test fit"] },
      job: { externalId: title, title, location: "Remote", isRemote: true, url: `https://example.com/${title}`, retrievedAt: NOW.toISOString() },
    });
    const md = renderDigest({
      runDate: "2026-08-08", reviewItems: [], now: NOW,
      companies: [{ company: growthFirst, matches: [role("Growth role", 50)] }, { company: fitFirst, matches: [role("Fit role", 90)] }],
    });
    const roles = md.slice(md.indexOf("## Roles for you"));
    expect(roles.indexOf("Fit first")).toBeLessThan(roles.indexOf("Growth first"));
    expect(growthFirst.score.score).toBeGreaterThan(fitFirst.score.score);
  });
});
