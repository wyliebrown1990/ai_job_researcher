import { expect, test, describe } from "bun:test";
import { Store } from "../src/db/db.ts";
import { ingestCandidates } from "../src/ingest.ts";
import { extractCandidates } from "../src/discover.ts";
import type { Candidate } from "../src/types.ts";

function cand(over: Partial<Candidate>): Candidate {
  return { displayName: "X", sources: [{ url: "https://techcrunch.com/x", date: "2026-08-08", primary: false }], ...over };
}

describe("ingestCandidates (DISCOVER → watchlist boundary)", () => {
  test("closed round + domain → added to watchlist with a funding event (E5 event)", () => {
    const store = new Store(":memory:");
    const s = ingestCandidates(store, [cand({
      displayName: "HappyRobot", domain: "https://happyrobot.ai",
      funding: { claimText: "raised $150M Series C", amountText: "$150M", stageText: "Series C", announcedDate: "2026-08-04", leadInvestors: ["Prysm"], otherInvestors: [] },
    })]);
    expect(s.added).toBe(1);
    const co = store.getCompany("happyrobot.ai");
    expect(co?.latestFunding?.stage).toBe("series-c");
    expect(co?.latestFunding?.amountUsd).toBe(150_000_000);
  });

  test("rumor + domain → tracked WITHOUT a funding event + a review item (E5 rumor)", () => {
    const store = new Store(":memory:");
    const s = ingestCandidates(store, [cand({
      displayName: "Harvey", domain: "harvey.ai",
      funding: { claimText: "in talks to raise $500M", leadInvestors: [], otherInvestors: [] },
    })]);
    expect(s.added).toBe(1);
    expect(s.reviewed).toBe(1);
    expect(store.getCompany("harvey.ai")?.latestFunding).toBeUndefined();
    expect(store.openReviewItems()[0]?.reason).toBe("rumored_unconfirmed");
  });

  test("no resolvable domain → review queue, not the watchlist (E4)", () => {
    const store = new Store(":memory:");
    const s = ingestCandidates(store, [cand({ displayName: "June AI", domain: undefined })]);
    expect(s.added).toBe(0);
    expect(s.reviewed).toBe(1);
    expect(store.openReviewItems()[0]?.reason).toBe("no_domain");
  });

  test("same domain twice → second refreshes, no duplicate (E4)", () => {
    const store = new Store(":memory:");
    ingestCandidates(store, [cand({ displayName: "HappyRobot", domain: "happyrobot.ai" })]);
    const s2 = ingestCandidates(store, [cand({ displayName: "Happyrobot Inc.", domain: "www.happyrobot.ai" })]);
    expect(s2.added).toBe(0);
    expect(s2.refreshed).toBe(1);
    const co = store.getCompany("happyrobot.ai");
    expect(co?.sightings).toBe(2);
    expect(co?.aliases).toContain("Happyrobot Inc.");
  });

  test("daily new-candidate cap bounds the funnel (design §6)", () => {
    const store = new Store(":memory:");
    const s = ingestCandidates(store, [
      cand({ displayName: "A", domain: "a.com" }),
      cand({ displayName: "B", domain: "b.com" }),
    ], { cap: 1 });
    expect(s.added).toBe(1);
    expect(s.reviewed).toBe(1);
  });
});

describe("extractCandidates (LLM output parsing)", () => {
  test("parses a fenced JSON array amid prose", () => {
    const text = 'Here are the companies:\n```json\n[{"displayName":"Acme","sources":[]}]\n```\nDone.';
    const out = extractCandidates(text);
    expect(out.length).toBe(1);
    expect(out[0]?.displayName).toBe("Acme");
  });
  test("returns [] on unparseable output", () => {
    expect(extractCandidates("no json here")).toEqual([]);
  });
});
