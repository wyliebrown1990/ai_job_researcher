import { afterEach, describe, expect, test } from "bun:test";
import { Store } from "../src/db/db.ts";
import type { Page } from "../src/fetchers/http.ts";
import type { AtsRef } from "../src/fetchers/ats/index.ts";
import { mapRippling } from "../src/fetchers/ats/rippling.ts";
import { mapWorkable } from "../src/fetchers/ats/workable.ts";
import { ingestCandidates } from "../src/ingest.ts";
import { nameKey } from "../src/lib/identity.ts";
import { boardMentionsCompany, findBoardRefs, findCareers, findUnreadableAts } from "../src/resolve/careers.ts";
import { guessDomains, hostMatchesName, resolveDomain, textNamesCompany } from "../src/resolve/domain.ts";
import { resolveCandidates, resolveCareersFor, runMaintenance, type ResolveDeps } from "../src/resolve/index.ts";
import { parseLookup } from "../src/resolve/search.ts";
import type { Candidate, Company, JobPosting } from "../src/types.ts";

// ---- offline web: url -> html, or { url, html } to simulate a redirect -------------
type Site = Record<string, string | { url: string; html: string }>;

function web(site: Site) {
  const requested: string[] = [];
  const fetchPage = async (url: string): Promise<Page | null> => {
    requested.push(url);
    const hit = site[url] ?? site[url.replace(/\/$/, "")];
    if (hit === undefined) return null;
    return typeof hit === "string" ? { url, status: 200, html: hit } : { url: hit.url, status: 200, html: hit.html };
  };
  return { fetchPage, requested };
}

function boards(map: Record<string, JobPosting[]>) {
  return async (ref: AtsRef) => {
    const jobs = map[`${ref.provider}:${ref.slug}`];
    if (!jobs) throw new Error("404");
    return jobs;
  };
}

function job(title: string, description = ""): JobPosting {
  return { externalId: title, title, location: "New York, NY", url: `https://example.com/${title}`, descriptionText: description, retrievedAt: "2026-10-15T00:00:00Z" };
}

const home = (title: string, body = "", extra = "") =>
  `<html><head><title>${title}</title><meta name="description" content="${body}"></head><body><p>${body}</p>${extra}</body></html>`;

const melius = {
  displayName: "Melius",
  description: "Melius builds AI agents that automate insurance claims processing for carriers.",
  category: "Insurtech AI",
  sources: [{ url: "https://www.businesswire.com/news/home/melius-raises-series-a" }],
};

const stores: Store[] = [];
function store(): Store {
  const s = new Store(":memory:");
  stores.push(s);
  return s;
}
afterEach(() => { while (stores.length) stores.pop()!.close(); });

describe("name helpers", () => {
  test("name keys collapse suffix variants but not different names", () => {
    expect(nameKey("June AI")).toBe(nameKey("June"));
    expect(nameKey("Aeries Technology (AxAI)")).toBe("aeries");
    expect(nameKey("Assort Health")).toBe("assorthealth");
    expect(nameKey("Onyx Security")).not.toBe(nameKey("Onyx"));
  });

  test("domain guesses start with the most likely forms", () => {
    expect(guessDomains("Stuut").slice(0, 3)).toEqual(["stuut.ai", "stuut.com", "stuut.io"]);
    expect(guessDomains("Katalyze AI")).toContain("katalyzeai.com");
  });

  test("host and text name matching", () => {
    expect(hostMatchesName("getmelius.com", "Melius")).toBe(true);
    expect(hostMatchesName("assort-health.com", "Assort Health")).toBe(true);
    expect(hostMatchesName("meliuscapital.com", "Melius")).toBe(false);
    expect(textNamesCompany("8090 | Software factory", "8090")).toBe(true);
    expect(textNamesCompany("Junebug outfitters", "June")).toBe(false);
  });
});

describe("domain resolution (stage 2)", () => {
  test("finds the site linked from a press release (Melius)", async () => {
    const { fetchPage } = web({
      "https://www.businesswire.com/news/home/melius-raises-series-a":
        `<a href="https://twitter.com/melius">X</a><a href="https://www.businesswire.com/">BW</a><p><a href="https://www.melius.com/">Melius</a> today announced…</p>`,
      "https://melius.com/": home("Melius | AI agents for insurance claims", "Automate insurance claims processing with AI agents built for carriers."),
    });
    const r = await resolveDomain(melius, { fetchPage });
    expect(r).toMatchObject({ domain: "melius.com", method: "source-link" });
    expect(r.confidence).toBeGreaterThanOrEqual(0.7);
  });

  test("verifies a name-based guess against the story (Stuut)", async () => {
    const { fetchPage } = web({
      "https://stuut.ai/": home("Stuut | AI agents for accounts receivable", "Stuut automates accounts receivable collections and cash application."),
    });
    const r = await resolveDomain({
      displayName: "Stuut", description: "Stuut uses AI agents to automate accounts receivable collections.", category: "Fintech AI", sources: [],
    }, { fetchPage });
    expect(r).toMatchObject({ domain: "stuut.ai", method: "guess" });
  });

  test("follows a redirect to the canonical domain and rejects parked pages", async () => {
    const { fetchPage } = web({
      "https://volta.ai/": home("volta.ai is for sale", "Buy this domain today"),
      "https://volta.com/": { url: "https://www.voltaenergy.com/", html: home("Volta Energy", "Utility-scale batteries") },
      "https://voltalabs.com/": home("Volta Labs | AI for chip verification", "AI agents that automate chip design verification."),
    });
    const r = await resolveDomain({ displayName: "Volta Labs", description: "AI agents for chip design verification", sources: [] }, { fetchPage });
    expect(r.domain).toBe("voltalabs.com");
    expect(r.candidates.map((c) => c.domain)).not.toContain("volta.ai");
  });

  test("a generic one-word name matched only by its domain stays in review", async () => {
    const { fetchPage } = web({ "https://june.ai/": home("June", "Welcome"), "https://june.health/": home("June", "Welcome to June") });
    const r = await resolveDomain({ displayName: "June", description: "Voice agents for dental clinics", sources: [] }, { fetchPage });
    expect(r.domain).toBeUndefined();
    expect(r.candidates[0]).toMatchObject({ domain: "june.ai" });
    // A search hit alone would score 0.7; with no context match a one-word name is capped.
    const viaSearch = await resolveDomain(
      { displayName: "June", description: "Voice agents for dental clinics", sources: [] },
      { fetchPage, search: async () => [{ url: "https://june.health/", method: "search" }] },
    );
    expect(viaSearch.domain).toBeUndefined();
  });

  test("falls back to search, and still verifies the hit", async () => {
    const { fetchPage } = web({
      "https://freehand.build/": home("Freehand — AI copilots for construction estimating", "Construction estimating and takeoff with AI copilots."),
      "https://randomblog.com/": home("Ten startups to watch", "freehand and others"),
    });
    const search = async () => [
      { url: "https://randomblog.com/post", method: "search" as const },
      { url: "https://freehand.build/", method: "search" as const },
    ];
    const r = await resolveDomain({ displayName: "Freehand", description: "AI copilots for construction estimating and takeoff", sources: [] }, { fetchPage, search });
    expect(r).toMatchObject({ domain: "freehand.build", method: "search" });
  });

  test("drops a provided domain whose page belongs to someone else", async () => {
    const { fetchPage } = web({
      "https://melius.ai/": home("Totally Different Co", "We sell shoes"),
      "https://www.businesswire.com/news/home/melius-raises-series-a": `<a href="https://melius.com">Melius</a>`,
      "https://melius.com/": home("Melius | AI agents for insurance claims", "Insurance claims processing automation."),
    });
    const s = store();
    const candidates: Candidate[] = [{ ...melius, domain: "melius.ai" }];
    await resolveCandidates(s, candidates, { fetchPage, fetchBoard: boards({}) });
    expect(candidates[0]!.domain).toBe("melius.com");
    expect(s.getNameDomain("Melius")).toBe("melius.com");
  });

  test("keeps a provided name-shaped domain even when the page hides the name", async () => {
    const candidates: Candidate[] = [{ displayName: "Acme", domain: "acme.ai", sources: [] }];
    await resolveCandidates(store(), candidates, { fetchPage: web({ "https://acme.ai/": home("Home", "") }).fetchPage, fetchBoard: boards({}) });
    expect(candidates[0]!.domain).toBe("acme.ai");
  });

  test("keeps a provided domain whose site can't be read (bot walls)", async () => {
    const candidates: Candidate[] = [{ displayName: "Acme", domain: "acme.ai", sources: [] }];
    await resolveCandidates(store(), candidates, { fetchPage: web({}).fetchPage, fetchBoard: boards({}) });
    expect(candidates[0]!.domain).toBe("acme.ai");
  });
});

describe("careers discovery (stage 2b)", () => {
  test("reads board slugs from links, iframes and embed scripts", () => {
    const html = `
      <script src="https://jobs.ashbyhq.com/acme/embed?version=2"></script>
      <iframe src="https://job-boards.greenhouse.io/embed/job_board?for=acmeai"></iframe>
      <script src="https://boards.greenhouse.io/embed/job_board/js?for=acme2"></script>
      <a href="https://jobs.lever.co/acme-inc/123">Lever</a>
      <a href="https://apply.workable.com/acme-co/">Workable</a>
      <a href="https://ats.rippling.com/acme-r/jobs">Rippling</a>`;
    expect(findBoardRefs(html)).toEqual([
      { provider: "greenhouse", slug: "acmeai" },
      { provider: "greenhouse", slug: "acme2" },
      { provider: "ashby", slug: "acme" },
      { provider: "lever", slug: "acme-inc" },
      { provider: "workable", slug: "acme-co" },
      { provider: "rippling", slug: "acme-r" },
    ]);
    expect(findUnreadableAts(`<a href="https://acme.bamboohr.com/careers">Jobs</a>`)).toBe("bamboohr");
  });

  test("finds the board linked from the homepage", async () => {
    const { fetchPage } = web({ "https://acme.ai/": home("Acme", "", `<script src="https://jobs.ashbyhq.com/acme/embed"></script>`) });
    const r = await findCareers("acme.ai", "Acme", { fetchPage, fetchBoard: boards({ "ashby:acme": [job("Sales Engineer")] }) });
    expect(r).toMatchObject({ ats: { provider: "ashby", slug: "acme" }, source: "homepage-link" });
  });

  test("follows the careers link and reads the board from that page", async () => {
    const { fetchPage } = web({
      "https://stuut.ai/": home("Stuut", "", `<a href="/company">About</a><a href="/careers">Careers</a>`),
      "https://stuut.ai/careers": `<iframe src="https://job-boards.greenhouse.io/embed/job_board?for=stuuttechnologies"></iframe>`,
    });
    const r = await findCareers("stuut.ai", "Stuut", { fetchPage, fetchBoard: boards({ "greenhouse:stuuttechnologies": [job("Solutions Engineer")] }) });
    expect(r).toMatchObject({ ats: { provider: "greenhouse", slug: "stuuttechnologies" }, source: "careers-page", careersUrl: "https://stuut.ai/careers" });
  });

  test("records the careers page when the ATS can't be read", async () => {
    const { fetchPage } = web({
      "https://melius.com/": home("Melius", "", `<a href="https://melius.com/jobs">We're hiring</a>`),
      "https://melius.com/jobs": `<a href="https://melius.bamboohr.com/careers/12">Sales Engineer</a>`,
    });
    const r = await findCareers("melius.com", "Melius", { fetchPage, fetchBoard: boards({}) });
    expect(r).toEqual({ careersUrl: "https://melius.com/jobs", unsupportedAts: "bamboohr" });
  });

  test("a guessed slug is used only when its postings mention the company", async () => {
    const fetchPage = web({}).fetchPage;
    const own = await findCareers("melius.com", "Melius", { fetchPage, fetchBoard: boards({ "ashby:melius": [job("Sales Engineer", "Join Melius to automate claims")] }) });
    expect(own).toMatchObject({ ats: { provider: "ashby", slug: "melius" }, source: "slug-guess" });
    const other = await findCareers("june.ai", "June", { fetchPage, fetchBoard: boards({ "ashby:june": [job("Engineer", "Join Junebug Apparel")] }) });
    expect(other.ats).toBeUndefined();
    expect(boardMentionsCompany([job("x", "careers at june.ai")], "june.ai", "June")).toBe(true);
  });
});

describe("review queue upkeep (stage 4)", () => {
  test("repeat sightings merge into one item instead of piling up", () => {
    const s = store();
    const item = (name: string, url: string) => ({ displayName: name, reason: "no_domain" as const, detail: "x", evidence: [{ claim: "c", sourceUrl: url, date: "2026-10-01", primary: false }], createdAt: "2026-10-01T00:00:00Z" });
    s.addReviewItem(item("June AI", "https://a.com/1"));
    s.addReviewItem(item("June", "https://a.com/2"));
    s.addReviewItem(item("Auger", "https://a.com/3"));
    const rows = s.openReviewRows();
    expect(rows).toHaveLength(2);
    const june = rows.find((row) => nameKey(row.item.displayName) === "june")!;
    expect(june.item.sightings).toBe(2);
    expect(june.item.evidence).toHaveLength(2);
  });

  test("collapses duplicates left by older runs", () => {
    const s = store();
    for (const at of ["2026-08-10", "2026-08-12"]) {
      s.db.query("INSERT INTO review_queue (domain, name, reason, data, created_at) VALUES (NULL, ?, 'no_domain', ?, ?)")
        .run("Auger", JSON.stringify({ displayName: "Auger", reason: "no_domain", detail: "x", evidence: [], createdAt: at }), at);
    }
    expect(s.collapseDuplicateReviewItems()).toBe(1);
    expect(s.openReviewRows()).toHaveLength(1);
  });

  test("ingesting the company with a domain closes its no_domain item", () => {
    const s = store();
    ingestCandidates(s, [{ displayName: "Melius", sources: [{ url: "https://news.example/1", date: "2026-10-01" }] }]);
    expect(s.openReviewRows()).toHaveLength(1);
    ingestCandidates(s, [{ displayName: "Melius", domain: "melius.com", sources: [{ url: "https://news.example/2", date: "2026-10-02" }] }]);
    expect(s.openReviewRows()).toHaveLength(0);
  });

  test("unresolved candidates carry their best verified domains into review", () => {
    const s = store();
    ingestCandidates(s, [{
      displayName: "June", sources: [], resolution: { confidence: 0.5, candidates: [{ domain: "june.ai", confidence: 0.5, method: "guess" }] },
    }]);
    const [row] = s.openReviewRows();
    expect(row!.item.candidates?.[0]?.domain).toBe("june.ai");
    expect(row!.item.detail).toContain("june.ai (50%)");
  });
});

describe("end to end with offline deps", () => {
  const site: Site = {
    "https://www.businesswire.com/news/home/melius-raises-series-a": `<a href="https://melius.com/">Melius</a>`,
    "https://melius.com/": home("Melius | AI agents for insurance claims", "Insurance claims processing automation for carriers.", `<a href="/careers">Careers</a>`),
    "https://melius.com/careers": `<a href="https://jobs.ashbyhq.com/melius">Open roles</a>`,
  };
  const deps = (): ResolveDeps => ({ fetchPage: web(site).fetchPage, fetchBoard: boards({ "ashby:melius": [job("Sales Engineer"), job("Account Executive")] }) });

  test("discovery output → verified domain → watchlist → job board", async () => {
    const s = store();
    const candidates: Candidate[] = [{ ...melius, sources: melius.sources.map((x) => ({ ...x, date: "2026-10-01" })) }];
    await resolveCandidates(s, candidates, deps());
    const summary = ingestCandidates(s, candidates);
    expect(summary.newDomains).toEqual(["melius.com"]);
    expect(await resolveCareersFor(s, summary.newDomains, deps())).toBe(1);
    expect(s.getCompany("melius.com")).toMatchObject({
      ats: { provider: "ashby", slug: "melius" }, atsSource: "careers-page", openRolesCount: 2,
      domainSource: { method: "source-link" },
    });
  });

  test("maintenance resolves the backlog, then backs off on items it can't resolve", async () => {
    const s = store();
    const now = new Date("2026-10-15T12:00:00Z");
    s.addReviewItem({
      displayName: "Melius", reason: "no_domain", detail: "x", createdAt: "2026-08-13T00:00:00Z",
      evidence: [{ claim: "Melius raised", sourceUrl: melius.sources[0]!.url, date: "2026-08-13", primary: true }],
      context: { description: melius.description, category: melius.category },
    });
    s.addReviewItem({ displayName: "Nowhere Labs", reason: "no_domain", detail: "x", evidence: [], createdAt: "2026-08-13T00:00:00Z" });

    const first = await runMaintenance(s, deps(), now);
    expect(first).toMatchObject({ backlogTried: 2, backlogResolved: 1, atsFound: 1 });
    expect(s.getCompany("melius.com")?.ats).toEqual({ provider: "ashby", slug: "melius" });
    const [left] = s.openReviewRows();
    expect(left!.item).toMatchObject({ displayName: "Nowhere Labs", resolveAttempts: 1 });

    const again = await runMaintenance(s, deps(), new Date("2026-10-15T18:00:00Z"));
    expect(again.backlogTried).toBe(0);
    const later = await runMaintenance(s, deps(), new Date("2026-10-17T12:00:00Z"));
    expect(later.backlogTried).toBe(1);
  });

  test("companies without a readable board are re-checked weekly", async () => {
    const s = store();
    const company: Company = {
      domain: "melius.com", displayName: "Melius", aliases: ["Melius"], status: "watching", roleWatches: [], evidence: [],
      firstSeen: "2026-09-01T00:00:00Z", lastUpdated: "2026-09-01T00:00:00Z", sightings: 1,
      atsDetection: "not-detected", atsCheckedAt: "2026-10-12T00:00:00Z",
    };
    s.upsertCompany(company);
    expect((await runMaintenance(s, deps(), new Date("2026-10-15T00:00:00Z"))).atsChecked).toBe(0);
    expect((await runMaintenance(s, deps(), new Date("2026-10-20T00:00:00Z"))).atsFound).toBe(1);
  });
});

describe("new board readers and search parsing", () => {
  test("maps Workable and Rippling postings", () => {
    const w = mapWorkable("acme", { jobs: [{ shortcode: "AB1", title: "Sales Engineer", city: "New York", state: "NY", country: "United States", telecommuting: false, url: "https://apply.workable.com/acme/j/AB1/" }] });
    expect(w[0]).toMatchObject({ externalId: "AB1", title: "Sales Engineer", location: "New York, NY, United States" });
    const r = mapRippling("acme", [{ uuid: "u1", name: "Solutions Consultant", workLocation: { label: "Remote (US)" }, department: { label: "Sales" } }]);
    expect(r[0]).toMatchObject({ externalId: "u1", title: "Solutions Consultant", location: "Remote (US)", isRemote: true, team: "Sales" });
  });

  test("parses the website lookup answer", () => {
    expect(parseLookup('```json\n{"website": "https://www.stuut.ai/", "evidenceUrl": "https://techcrunch.com/x"}\n```'))
      .toEqual([{ url: "https://www.stuut.ai/", method: "llm", evidenceUrl: "https://techcrunch.com/x" }]);
    expect(parseLookup('{"website": null}')).toEqual([]);
  });
});
