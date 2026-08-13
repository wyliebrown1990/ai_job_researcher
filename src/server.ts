import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Store } from "./db/db.ts";
import { fetchBoard } from "./fetchers/ats/index.ts";
import { matchBoard } from "./lib/roleMatch.ts";
import { companyKey } from "./lib/identity.ts";
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

type RoleEntry = {
  domain: string;
  displayName: string;
  category?: string;
  score: number;
  role: string;
  fitCaveat?: string;
  job: ReturnType<typeof matchBoard>[number]["job"];
  state: ReturnType<Store["getRoleState"]>;
};

async function collectRoles(store: Store): Promise<RoleEntry[]> {
  const profile = store.getSearchProfile();
  const companies = store.allCompanies().filter((company) =>
    (company.score?.score ?? 0) >= profile.minCompanyScore
    && (profile.includedSectors.length === 0 || profile.includedSectors.some((sector) => company.category?.toLowerCase().includes(sector.toLowerCase()))),
  );
  const batches = await Promise.all(companies.map(async (company) => {
    if (!company.ats) return [] as RoleEntry[];
    try {
      return matchBoard(await fetchBoard(company.ats), profile).map((match) => ({
        domain: company.domain,
        displayName: company.displayName,
        category: company.category,
        score: company.score?.score ?? 0,
        role: match.role,
        fitCaveat: match.fitCaveat,
        job: match.job,
        state: store.getRoleState(company.domain, match.job.externalId),
      }));
    } catch { return [] as RoleEntry[]; }
  }));
  return batches.flat().sort((a, b) => b.score - a.score);
}

function validApplicationStatus(value: unknown): value is import("./types.ts").ApplicationStatus {
  return ["researching", "networking", "applied", "interviewing", "closed"].includes(String(value));
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
      const nextActions = store.applications().filter((application) => application.nextActionAt)
        .map((application) => ({
          ...application,
          company: store.getCompany(application.domain)?.displayName ?? application.domain,
        }))
        .sort((a, b) => (a.nextActionAt ?? "").localeCompare(b.nextActionAt ?? ""));
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
        nextActions,
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

    if (request.method === "GET" && pathname === "/api/review") return json({ items: store.openReviewRows() });

    const reviewMatch = /^\/api\/review\/(\d+)\/resolve$/.exec(pathname);
    if (request.method === "POST" && reviewMatch) {
      const id = Number(reviewMatch[1]);
      const row = store.openReviewRows().find((item) => item.id === id);
      if (!row) return json({ error: "Review item not found." }, 404);
      const body = await request.json().catch(() => null) as { action?: unknown; domain?: unknown } | null;
      if (body?.action === "dismiss") return store.resolveReviewItem(id) ? json({ resolved: true }) : json({ error: "Review item not found." }, 404);
      if (body?.action === "promote" && typeof body.domain === "string") {
        const domain = companyKey(body.domain);
        if (!domain) return badRequest("Enter a valid company domain before promoting this item.");
        if (!store.getCompany(domain)) {
          const now = new Date().toISOString();
          store.upsertCompany({
            domain, displayName: row.item.displayName, aliases: [row.item.displayName], status: "watching",
            roleWatches: [], evidence: row.item.evidence, firstSeen: now, lastUpdated: now, sightings: 1, pinned: true,
          });
        }
        store.resolveReviewItem(id);
        return json({ resolved: true, company: store.getCompany(domain) });
      }
      return badRequest("Choose dismiss or provide a valid domain to promote.");
    }

    if (request.method === "PUT" && pathname === "/api/profile") {
      const next = sanitizeProfile(await request.json().catch(() => null), store.getSearchProfile());
      return next ? json(store.saveSearchProfile(next)) : badRequest("Use a valid search profile.");
    }

    if (request.method === "GET" && pathname === "/api/roles") {
      let roles = await collectRoles(store);
      const family = url.searchParams.get("family");
      const remote = url.searchParams.get("remote");
      const include = url.searchParams.get("include") === "true";
      if (family) roles = roles.filter((role) => role.role === family);
      if (remote === "true") roles = roles.filter((role) => role.job.isRemote);
      if (!include) roles = roles.filter((role) => !role.state?.hidden && !role.state?.applied);
      return json({ roles });
    }

    if (request.method === "GET" && pathname === "/api/applications") {
      const roles = await collectRoles(store);
      return json({ applications: store.applications().map((application) => ({
        ...application,
        role: roles.find((role) => role.domain === application.domain && role.job.externalId === application.externalId) ?? null,
      })) });
    }

    const roleStateMatch = /^\/api\/roles\/([^/]+)\/([^/]+)\/state$/.exec(pathname);
    if (request.method === "POST" && roleStateMatch) {
      const domain = decodeURIComponent(roleStateMatch[1]!);
      if (!store.getCompany(domain)) return json({ error: "Company not found." }, 404);
      const body = await request.json().catch(() => null) as Record<string, unknown> | null;
      if (!body) return badRequest("Use a valid role state.");
      const allowed = ["saved", "hidden", "applied", "fitOverride"] as const;
      if (!Object.keys(body).some((key) => allowed.includes(key as typeof allowed[number]))) return badRequest("No role state fields were supplied.");
      if (["saved", "hidden", "applied"].some((key) => body[key] !== undefined && typeof body[key] !== "boolean")) return badRequest("Role flags must be true or false.");
      if (body.fitOverride !== undefined && !["good", "maybe", "poor", null].includes(body.fitOverride as string | null)) return badRequest("Use a valid fit override.");
      return json(store.upsertRoleState(domain, decodeURIComponent(roleStateMatch[2]!), body));
    }

    const applicationMatch = /^\/api\/roles\/([^/]+)\/([^/]+)\/application$/.exec(pathname);
    if (["POST", "PATCH"].includes(request.method) && applicationMatch) {
      const domain = decodeURIComponent(applicationMatch[1]!);
      if (!store.getCompany(domain)) return json({ error: "Company not found." }, 404);
      const externalId = decodeURIComponent(applicationMatch[2]!);
      const body = await request.json().catch(() => null) as Record<string, unknown> | null;
      if (!body) return badRequest("Use a valid application.");
      const status = body.status ?? "researching";
      if (!validApplicationStatus(status)) return badRequest("Use a valid application status.");
      if (body.notes !== undefined && typeof body.notes !== "string") return badRequest("Notes must be text.");
      const application = request.method === "POST"
        ? store.createApplication({ domain, externalId, status, notes: typeof body.notes === "string" ? body.notes : "", nextActionAt: typeof body.nextActionAt === "string" ? body.nextActionAt : undefined, appliedAt: status === "applied" ? new Date().toISOString() : undefined })
        : store.updateApplication(domain, externalId, { status, notes: typeof body.notes === "string" ? body.notes : undefined, nextActionAt: typeof body.nextActionAt === "string" ? body.nextActionAt : undefined });
      if (!application) return json({ error: "Application not found." }, 404);
      if (status === "applied") store.upsertRoleState(domain, externalId, { applied: true });
      return json(application);
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
