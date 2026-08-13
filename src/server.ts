import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Store } from "./db/db.ts";
import { fetchBoard } from "./fetchers/ats/index.ts";
import { matchBoard } from "./lib/roleMatch.ts";
import { renderDashboard } from "./dashboard.ts";
import type { Company, RoleMatch, SearchProfile, TargetRole } from "./types.ts";

type CompanySummary = ReturnType<typeof companySummary>;

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

function badRequest(message: string): Response {
  return json({ error: message }, 400);
}

function companySummary(store: Store, company: Company) {
  const snapshots = store.snapshotsFor(company.domain);
  const latest = snapshots.at(-1);
  const previous = snapshots.at(-2);
  return {
    domain: company.domain,
    displayName: company.displayName,
    description: company.description,
    category: company.category,
    hq: company.hq,
    score: company.score?.score ?? null,
    bucket: company.score?.bucket ?? "watching",
    confidence: company.score?.confidence ?? "low",
    scoreDelta: latest && previous && latest.score !== undefined && previous.score !== undefined
      ? latest.score - previous.score
      : (company.priorScore === undefined || company.score === undefined ? null : company.score.score - company.priorScore),
    openRolesCount: company.openRolesCount ?? 0,
    matchingRolesCount: latest?.matchingRolesCount ?? 0,
    latestFunding: company.latestFunding,
    pinned: Boolean(company.pinned),
    notes: company.notes ?? "",
    firstSeen: company.firstSeen,
    lastUpdated: company.lastUpdated,
  };
}

function latestDigestPaths(): { date: string; path: string }[] {
  try {
    return readdirSync("digests")
      .map((name) => /^digest-(\d{4}-\d{2}-\d{2})\.md$/.exec(name))
      .filter((match): match is RegExpExecArray => Boolean(match))
      .map((match) => ({ date: match[1]!, path: join("digests", match[0]) }))
      .sort((a, b) => b.date.localeCompare(a.date));
  } catch {
    return [];
  }
}

function sanitizeProfile(input: unknown, current: SearchProfile): Omit<SearchProfile, "updatedAt"> | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Record<string, unknown>;
  const validRoles: TargetRole[] = ["solutions-engineer", "sales-engineer", "product-manager", "partnerships", "forward-deployed"];
  const roles = Array.isArray(value.targetRoles) && value.targetRoles.every((item) => typeof item === "string")
    ? value.targetRoles.filter((item): item is TargetRole => typeof item === "string" && validRoles.includes(item as TargetRole))
    : current.targetRoles;
  const strings = (key: "acceptedLocations" | "includedSectors" | "excludedKeywords") =>
    Array.isArray(value[key]) ? value[key].filter((item): item is string => typeof item === "string").slice(0, 20) : current[key];
  const remotePreference = ["any", "remote-only", "remote-or-location", "location-only"].includes(String(value.remotePreference))
    ? String(value.remotePreference) as SearchProfile["remotePreference"]
    : current.remotePreference;
  const number = (key: "minCompanyScore" | "minExperienceYears" | "maxExperienceYears") => {
    const raw = value[key];
    if (raw === undefined || raw === "") return key === "minCompanyScore" ? current.minCompanyScore : undefined;
    return typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : current[key];
  };
  return {
    targetRoles: roles,
    acceptedLocations: strings("acceptedLocations"),
    remotePreference,
    includedSectors: strings("includedSectors"),
    excludedKeywords: strings("excludedKeywords"),
    minCompanyScore: Math.min(100, number("minCompanyScore") as number),
    minExperienceYears: number("minExperienceYears") as number | undefined,
    maxExperienceYears: number("maxExperienceYears") as number | undefined,
  };
}

export function createDashboardHandler(store: Store): (request: Request) => Response | Promise<Response> {
  return async (request) => {
    const url = new URL(request.url);
    const { pathname } = url;
    if (!pathname.startsWith("/api/")) {
      return new Response(renderDashboard(), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    if (request.method === "GET" && pathname === "/api/today") {
      const companies = store.allCompanies().map((company) => companySummary(store, company));
      const movers = [...companies].filter((company) => company.scoreDelta && company.scoreDelta !== 0)
        .sort((a, b) => Math.abs(b.scoreDelta ?? 0) - Math.abs(a.scoreDelta ?? 0)).slice(0, 6);
      const roleChanges = companies.filter((company) => company.matchingRolesCount > 0)
        .sort((a, b) => b.matchingRolesCount - a.matchingRolesCount).slice(0, 6);
      return json({
        updatedAt: companies.map((company) => company.lastUpdated).sort().at(-1) ?? null,
        totals: {
          companies: companies.length,
          matchingRoles: companies.reduce((sum, company) => sum + company.matchingRolesCount, 0),
          pinned: companies.filter((company) => company.pinned).length,
          review: store.openReviewItems().length,
        },
        movers,
        roleChanges,
        following: companies.filter((company) => company.pinned),
      });
    }

    if (request.method === "GET" && pathname === "/api/companies") {
      let companies = store.allCompanies().map((company) => companySummary(store, company));
      const bucket = url.searchParams.get("bucket");
      const pinned = url.searchParams.get("pinned");
      if (bucket) companies = companies.filter((company) => company.bucket === bucket);
      if (pinned === "true") companies = companies.filter((company) => company.pinned);
      const sort = url.searchParams.get("sort") ?? "score";
      companies.sort((a, b) => {
        if (sort === "roles") return b.matchingRolesCount - a.matchingRolesCount;
        if (sort === "recent") return b.lastUpdated.localeCompare(a.lastUpdated);
        return (b.score ?? 0) - (a.score ?? 0);
      });
      return json({ companies });
    }

    if (request.method === "GET" && pathname === "/api/profile") return json(store.getSearchProfile());

    if (request.method === "PUT" && pathname === "/api/profile") {
      const next = sanitizeProfile(await request.json().catch(() => null), store.getSearchProfile());
      return next ? json(store.saveSearchProfile(next)) : badRequest("Use a valid search profile.");
    }

    const companyMatch = /^\/api\/companies\/([^/]+)$/.exec(pathname);
    if (request.method === "GET" && companyMatch) {
      const company = store.getCompany(decodeURIComponent(companyMatch[1]!));
      if (!company) return json({ error: "Company not found." }, 404);
      let roles: RoleMatch[] = [];
      if (company.ats) {
        try { roles = matchBoard(await fetchBoard(company.ats), store.getSearchProfile()); } catch { roles = []; }
      }
      return json({
        company: companySummary(store, company),
        snapshots: store.snapshotsFor(company.domain),
        fundingHistory: store.fundingHistory(company.domain),
        roles,
        evidence: company.evidence,
      });
    }

    const pinMatch = /^\/api\/companies\/([^/]+)\/pin$/.exec(pathname);
    if (request.method === "POST" && pinMatch) {
      const company = store.getCompany(decodeURIComponent(pinMatch[1]!));
      if (!company) return json({ error: "Company not found." }, 404);
      const body = await request.json().catch(() => null) as { pinned?: unknown } | null;
      if (typeof body?.pinned !== "boolean") return badRequest("pinned must be true or false.");
      store.setPinned(company.domain, body.pinned);
      return json(companySummary(store, store.getCompany(company.domain)!));
    }

    const notesMatch = /^\/api\/companies\/([^/]+)\/notes$/.exec(pathname);
    if (request.method === "POST" && notesMatch) {
      const company = store.getCompany(decodeURIComponent(notesMatch[1]!));
      if (!company) return json({ error: "Company not found." }, 404);
      const body = await request.json().catch(() => null) as { notes?: unknown } | null;
      if (typeof body?.notes !== "string" || body.notes.length > 10_000) return badRequest("notes must be plain text under 10,000 characters.");
      store.setNotes(company.domain, body.notes);
      return json(companySummary(store, store.getCompany(company.domain)!));
    }

    if (request.method === "GET" && pathname === "/api/digests") return json({ digests: latestDigestPaths().map(({ date }) => ({ date })) });
    const digestMatch = /^\/api\/digests\/(\d{4}-\d{2}-\d{2})$/.exec(pathname);
    if (request.method === "GET" && digestMatch) {
      const path = join("digests", `digest-${digestMatch[1]}.md`);
      try { return json({ date: digestMatch[1], markdown: readFileSync(path, "utf8") }); } catch { return json({ error: "Digest not found." }, 404); }
    }

    return json({ error: "Not found." }, 404);
  };
}

export function startServer(port = 3000): ReturnType<typeof Bun.serve> {
  const store = new Store();
  const server = Bun.serve({ hostname: "127.0.0.1", port, fetch: createDashboardHandler(store) });
  console.log(`AI Career Intelligence Console → http://127.0.0.1:${server.port}`);
  return server;
}
