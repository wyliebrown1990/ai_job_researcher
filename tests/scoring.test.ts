import { expect, test, describe } from "bun:test";
import { deriveComponents, scoreCompany } from "../src/lib/scoring.ts";
import type { FundingEvent } from "../src/types.ts";

const NOW = new Date("2026-08-08T00:00:00Z");

function round(stage: FundingEvent["stage"], amountUsd: number, date: string): FundingEvent {
  return { stage, amountUsd, leadInvestors: [], otherInvestors: [], announcedDate: date, evidence: [] };
}

describe("scoring (E2: funding != growth)", () => {
  test("marquee pre-seed with no traction is Notable-but-unproven, NOT a top mover", () => {
    // June AI shape: real $20M pre-seed, ~0 traction, tiny team.
    const comps = deriveComponents({
      fundingEvent: round("pre-seed", 20_000_000, "2026-08-03"),
      openRolesCount: 1,
      customerTraction: 0.05,
      productMomentum: 0.4,
      newestEvidenceDate: "2026-08-03",
      primarySourceCount: 2,
      totalSourceCount: 3,
    }, NOW);
    const s = scoreCompany(comps, { isNew: true });
    expect(s.bucket).not.toBe("top-mover");
    expect(["notable-unproven", "new-entrant"]).toContain(s.bucket);
  });

  test("strong traction + hiring + recent round is a Top Mover", () => {
    // HappyRobot shape: big round, many customers, hiring.
    const comps = deriveComponents({
      fundingEvent: round("series-c", 150_000_000, "2026-08-04"),
      openRolesCount: 20,
      priorOpenRolesCount: 8,
      customerTraction: 0.85,
      productMomentum: 0.8,
      newestEvidenceDate: "2026-08-04",
      primarySourceCount: 4,
      totalSourceCount: 5,
    }, NOW);
    const s = scoreCompany(comps, { isNew: true });
    expect(s.bucket).toBe("top-mover");
    expect(s.score).toBeGreaterThan(65);
    expect(s.confidence).toBe("high");
  });

  test("no domain forces review-queue", () => {
    const comps = deriveComponents({}, NOW);
    expect(scoreCompany(comps, { unresolved: true }).bucket).toBe("review-queue");
  });

  test("weighted score never exceeds 100", () => {
    const comps = deriveComponents({
      fundingEvent: round("series-d-plus", 5_000_000_000, "2026-08-08"),
      openRolesCount: 200, priorOpenRolesCount: 0,
      customerTraction: 1, productMomentum: 1,
      newestEvidenceDate: "2026-08-08", primarySourceCount: 10, totalSourceCount: 10,
    }, NOW);
    expect(scoreCompany(comps).score).toBeLessThanOrEqual(100);
  });
});
