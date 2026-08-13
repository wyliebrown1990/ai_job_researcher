import { afterEach, describe, expect, test } from "bun:test";
import { Store } from "../src/db/db.ts";
import { createDashboardHandler } from "../src/server.ts";
import type { Company } from "../src/types.ts";

const stores: Store[] = [];

function setup() {
  const store = new Store(":memory:");
  stores.push(store);
  const company: Company = {
    domain: "example.ai",
    displayName: "Example AI",
    aliases: ["Example AI"],
    description: "Evidence-backed AI infrastructure.",
    status: "watching",
    roleWatches: [],
    evidence: [],
    firstSeen: "2026-08-13T00:00:00.000Z",
    lastUpdated: "2026-08-13T00:00:00.000Z",
    sightings: 1,
    score: {
      score: 71,
      bucket: "top-mover",
      confidence: "high",
      components: { fundingMomentum: 0.2, customerTraction: 0.3, hiringVelocity: 0.2, productMomentum: 0.2, evidenceQuality: 0.1 },
      breakdown: { fundingMomentum: 6, customerTraction: 7.5, hiringVelocity: 4, productMomentum: 3, evidenceQuality: 1 },
    },
  };
  store.upsertCompany(company);
  store.writeSnapshot(company, "2026-08-13", 4);
  return { store, handler: createDashboardHandler(store) };
}

afterEach(() => { while (stores.length) stores.pop()!.close(); });

describe("local dashboard API", () => {
  test("serves a data-backed Today briefing and company detail", async () => {
    const { handler } = setup();
    const today = await handler(new Request("http://local/api/today"));
    expect(await today.json()).toMatchObject({ totals: { companies: 1, matchingRoles: 4 } });

    const detail = await handler(new Request("http://local/api/companies/example.ai"));
    expect(await detail.json()).toMatchObject({ company: { displayName: "Example AI", score: 71 } });
  });

  test("persists profile and company mutations through the API", async () => {
    const { handler } = setup();
    const profile = await handler(new Request("http://local/api/profile", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetRoles: ["product-manager"], remotePreference: "remote-only", minCompanyScore: 60 }),
    }));
    expect(await profile.json()).toMatchObject({ targetRoles: ["product-manager"], remotePreference: "remote-only" });

    const pin = await handler(new Request("http://local/api/companies/example.ai/pin", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pinned: true }),
    }));
    expect(await pin.json()).toMatchObject({ pinned: true });
  });
});
