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

  test("adds a manual company as a pinned research record with a validated domain", async () => {
    const { handler } = setup();
    const added = await handler(new Request("http://local/api/companies", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "Manual AI", domain: "https://manual.ai/about" }),
    }));
    expect(added.status).toBe(201);
    expect(await added.json()).toMatchObject({
      existing: false, company: { domain: "manual.ai", displayName: "Manual AI", pinned: true, atsDetection: "checking" },
    });

    const invalid = await handler(new Request("http://local/api/companies", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "No Domain", domain: "not-a-domain" }),
    }));
    expect(invalid.status).toBe(400);
  });

  test("persists role actions and a role-level application through the API", async () => {
    const { handler } = setup();
    const state = await handler(new Request("http://local/api/roles/example.ai/job-1/state", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ saved: true }),
    }));
    expect(await state.json()).toMatchObject({ domain: "example.ai", externalId: "job-1", saved: true });

    const application = await handler(new Request("http://local/api/roles/example.ai/job-1/application", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "researching", notes: "Review the deployment work." }),
    }));
    expect(await application.json()).toMatchObject({ status: "researching", notes: "Review the deployment work." });

    const update = await handler(new Request("http://local/api/roles/example.ai/job-1/application", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "networking", nextActionAt: "2026-08-20" }),
    }));
    expect(await update.json()).toMatchObject({ status: "networking", nextActionAt: "2026-08-20" });

    const today = await handler(new Request("http://local/api/today"));
    expect(await today.json()).toMatchObject({
      nextActions: [{ domain: "example.ai", externalId: "job-1", company: "Example AI", nextActionAt: "2026-08-20" }],
    });

    const deleted = await handler(new Request("http://local/api/roles/example.ai/job-1/application", { method: "DELETE" }));
    expect(await deleted.json()).toEqual({ deleted: true });
  });

  test("dismisses or promotes review items only with a valid domain", async () => {
    const { store, handler } = setup();
    store.addReviewItem({ displayName: "Candidate", reason: "no_domain", detail: "Needs identity.", evidence: [], createdAt: "2026-08-13T00:00:00Z" });
    const review = await handler(new Request("http://local/api/review"));
    const item = (await review.json() as { items: { id: number }[] }).items[0]!;

    const promoted = await handler(new Request(`http://local/api/review/${item.id}/resolve`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "promote", domain: "candidate.ai" }),
    }));
    expect(await promoted.json()).toMatchObject({ resolved: true, company: { domain: "candidate.ai", pinned: true } });
  });
});
