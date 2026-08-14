import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Store } from "./db/db.ts";
import { detectBoard, fetchBoard } from "./fetchers/ats/index.ts";
import { nowIso } from "./fetchers/http.ts";
import { matchBoard } from "./lib/roleMatch.ts";
import { companyKey } from "./lib/identity.ts";
import { buildDiscoveryContext } from "./discover.ts";
import { evaluateRelevance } from "./lib/relevance.ts";
import { canonicalLocationLabel, searchLocations } from "./lib/locations.ts";
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
    relevance: evaluateRelevance(company, store.getSearchProfile()),
    atsDetection: company.atsDetection ?? (company.ats ? "available" : undefined),
    atsCheckedAt: company.atsCheckedAt,
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
  const stages = ["pre-seed", "seed", "series-a", "series-b", "series-c", "series-d-plus", "growth", "unknown"] as const;
  const teamSizes = ["1-10", "11-50", "51-200", "201-1000", "1000-plus"] as const;
  const signals = ["funding", "traction", "hiring", "launches", "leadership", "open-roles"] as const;
  const roles = Array.isArray(value.targetRoles) && value.targetRoles.every((item) => typeof item === "string")
    ? value.targetRoles.filter((item): item is TargetRole => typeof item === "string" && validRoles.includes(item as TargetRole))
    : current.targetRoles;
  const strings = <K extends keyof Pick<SearchProfile, "acceptedLocations" | "includedSectors" | "businessModelThemes" | "customTitlePhrases" | "excludedKeywords" | "excludedCompanyDomains">>(key: K, max = 20, maxLength = 80): SearchProfile[K] | null => {
    if (!(key in value)) return current[key];
    if (!Array.isArray(value[key]) || !value[key].every((item) => typeof item === "string")) return null;
    const seen = new Set<string>();
    const result: string[] = [];
    for (const raw of value[key] as string[]) {
      const item = raw.trim().replace(/\s+/g, " ");
      if (!item) continue;
      if (item.length > maxLength || result.length >= max) return null;
      const normalized = item.toLowerCase();
      if (!seen.has(normalized)) { seen.add(normalized); result.push(item); }
    }
    return result as SearchProfile[K];
  };
  const acceptedLocations = strings("acceptedLocations");
  const includedSectors = strings("includedSectors");
  const businessModelThemes = strings("businessModelThemes");
  const customTitlePhrases = strings("customTitlePhrases", 12, 80);
  const excludedKeywords = strings("excludedKeywords");
  const excludedCompanyRaw = strings("excludedCompanyDomains", 20, 120);
  if (!acceptedLocations || !includedSectors || !businessModelThemes || !customTitlePhrases || !excludedKeywords || !excludedCompanyRaw) return null;
  const canonicalLocations = acceptedLocations.map(canonicalLocationLabel);
  if (canonicalLocations.some((location) => !location)) return null;
  const excludedCompanyDomains = excludedCompanyRaw.map((domain) => companyKey(domain));
  if (excludedCompanyDomains.some((domain) => !domain)) return null;
  const enumList = <T extends string>(key: string, allowed: readonly T[], fallback: T[]): T[] | null => {
    if (!(key in value)) return fallback;
    if (!Array.isArray(value[key]) || !value[key].every((item) => typeof item === "string" && allowed.includes(item as T))) return null;
    return [...new Set(value[key] as T[])];
  };
  const preferredStages = enumList("preferredStages", stages, current.preferredStages);
  const preferredTeamSizes = enumList("preferredTeamSizes", teamSizes, current.preferredTeamSizes);
  const signalInterests = enumList("signalInterests", signals, current.signalInterests);
  if (!preferredStages || !preferredTeamSizes || !signalInterests) return null;
  const enumValue = <T extends string>(key: string, allowed: readonly T[], fallback: T): T | null => {
    if (!(key in value)) return fallback;
    return typeof value[key] === "string" && allowed.includes(value[key] as T) ? value[key] as T : null;
  };
  const remotePreference = ["any", "remote-only", "remote-or-location", "location-only"].includes(String(value.remotePreference))
    ? String(value.remotePreference) as SearchProfile["remotePreference"]
    : current.remotePreference;
  const sectorPreferenceStrength = enumValue("sectorPreferenceStrength", ["preferred", "required"] as const, current.sectorPreferenceStrength);
  const stagePreferenceStrength = enumValue("stagePreferenceStrength", ["preferred", "required"] as const, current.stagePreferenceStrength);
  const teamSizePreferenceStrength = enumValue("teamSizePreferenceStrength", ["preferred", "required"] as const, current.teamSizePreferenceStrength);
  const equityPriority = enumValue("equityPriority", ["not-a-factor", "nice-to-have", "important", "must-discuss"] as const, current.equityPriority);
  if (!sectorPreferenceStrength || !stagePreferenceStrength || !teamSizePreferenceStrength || !equityPriority) return null;
  const searchBrief = !("searchBrief" in value) ? current.searchBrief : typeof value.searchBrief === "string" && value.searchBrief.trim().length <= 500
    ? value.searchBrief.trim() : null;
  const compensationNote = !("compensationNote" in value) ? current.compensationNote : typeof value.compensationNote === "string" && value.compensationNote.trim().length <= 300
    ? value.compensationNote.trim() : null;
  if (searchBrief === null || compensationNote === null) return null;
  const number = (key: "minCompanyScore" | "minExperienceYears" | "maxExperienceYears") => {
    const raw = value[key];
    if (raw === undefined || raw === "") return key === "minCompanyScore" ? current.minCompanyScore : undefined;
    return typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : current[key];
  };
  return {
    targetRoles: roles,
    customTitlePhrases,
    acceptedLocations: canonicalLocations as string[],
    remotePreference,
    includedSectors,
    sectorPreferenceStrength,
    businessModelThemes,
    preferredStages,
    stagePreferenceStrength,
    preferredTeamSizes,
    teamSizePreferenceStrength,
    excludedCompanyDomains: excludedCompanyDomains as string[],
    equityPriority,
    compensationNote,
    signalInterests,
    searchBrief,
    excludedKeywords,
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
  customTitlePhrase?: string;
  fitCaveat?: string;
  relevance: ReturnType<typeof evaluateRelevance>;
  job: ReturnType<typeof matchBoard>[number]["job"];
  state: ReturnType<Store["getRoleState"]>;
};

function roleSeniority(role: RoleEntry): "entry" | "mid" | "senior" {
  const title = role.job.title.toLowerCase();
  if (/\b(intern|junior|associate|new grad)\b/.test(title)) return "entry";
  if (/\b(senior|staff|principal|lead|director|head|vice president|\bvp\b)\b/.test(title)) return "senior";
  return "mid";
}

async function collectRoles(store: Store): Promise<RoleEntry[]> {
  const profile = store.getSearchProfile();
  const companies = store.allCompanies().filter((company) =>
    (company.score?.score ?? 0) >= profile.minCompanyScore,
  );
  const batches = await Promise.all(companies.map(async (company) => {
    if (!company.ats) return [] as RoleEntry[];
    try {
      const jobs = store.cachedJobs(company.domain);
      return matchBoard(jobs.length ? jobs : await fetchBoard(company.ats), profile).map((match) => {
        const relevance = evaluateRelevance(company, profile, match.job);
        return {
          domain: company.domain, displayName: company.displayName, category: company.category,
          score: company.score?.score ?? 0, role: match.role, customTitlePhrase: match.customTitlePhrase, fitCaveat: match.fitCaveat,
          job: match.job, relevance, state: store.getRoleState(company.domain, match.job.externalId),
        };
      }).filter((entry) => entry.relevance.included);
    } catch { return [] as RoleEntry[]; }
  }));
  return batches.flat().sort((a, b) => b.relevance.score - a.relevance.score || b.score - a.score);
}

function validApplicationStatus(value: unknown): value is import("./types.ts").ApplicationStatus {
  return ["researching", "networking", "applied", "interviewing", "closed"].includes(String(value));
}

async function resolveManualAts(store: Store, domain: string): Promise<void> {
  for (const slug of [domain, domain.split(".")[0]!]) {
    const found = await detectBoard(slug).catch(() => null);
    if (!found) continue;
    const company = store.getCompany(domain);
    if (!company) return;
    company.ats = found.ref;
    company.atsDetection = "available";
    company.atsCheckedAt = nowIso();
    company.openRolesCount = found.jobs.length;
    store.upsertCompany(company);
    store.replaceCachedJobs(domain, found.jobs);
    return;
  }
  const company = store.getCompany(domain);
  if (!company) return;
  company.atsDetection = "not-detected";
  company.atsCheckedAt = nowIso();
  store.upsertCompany(company);
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
      const recentRoleUpdates = store.recentRoleStates().map((state) => {
        const company = store.getCompany(state.domain);
        const job = store.cachedJobs(state.domain).find((item) => item.externalId === state.externalId);
        return {
          ...state,
          company: company?.displayName ?? state.domain,
          title: job?.title ?? "Role no longer live",
        };
      });
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
        recentFunding: companies.filter((company) => company.latestFunding)
          .map((company) => ({ company: company.displayName, funding: company.latestFunding! }))
          .sort((a, b) => b.funding.announcedDate.localeCompare(a.funding.announcedDate)).slice(0, 6),
        recentRoleUpdates,
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
    if (request.method === "GET" && pathname === "/api/locations") {
      const query = new URL(request.url).searchParams.get("q") ?? "";
      return json({ locations: searchLocations(query), attribution: "Location data © Countries States Cities Database (MIT)" });
    }
    if (request.method === "GET" && pathname === "/api/profile/brief") {
      const profile = store.getSearchProfile();
      return json({ brief: buildDiscoveryContext(profile), updatedAt: profile.updatedAt });
    }

    if (request.method === "POST" && pathname === "/api/companies") {
      const body = await request.json().catch(() => null) as { domain?: unknown; displayName?: unknown } | null;
      const domain = companyKey(typeof body?.domain === "string" ? body.domain : "");
      const displayName = typeof body?.displayName === "string" ? body.displayName.trim() : "";
      if (!domain) return badRequest("Enter a valid company domain.");
      if (!displayName || displayName.length > 120) return badRequest("Enter a company name under 120 characters.");
      const existing = store.getCompany(domain);
      if (existing) return json({ company: companySummary(store, existing), existing: true });
      const now = nowIso();
      store.upsertCompany({
        domain, displayName, aliases: [displayName], status: "watching", roleWatches: [],
        evidence: [], firstSeen: now, lastUpdated: now, sightings: 1, pinned: true,
        atsDetection: "checking",
      });
      void resolveManualAts(store, domain);
      return json({ company: companySummary(store, store.getCompany(domain)!), existing: false }, 201);
    }

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
      const location = url.searchParams.get("location")?.trim().toLowerCase();
      const seniority = url.searchParams.get("seniority");
      const sector = url.searchParams.get("sector")?.trim().toLowerCase();
      const minimumScore = Number(url.searchParams.get("minScore"));
      const includeRaw = url.searchParams.get("include") ?? "";
      const included = new Set((includeRaw === "true" ? "applied,hidden" : includeRaw).split(",").filter(Boolean));
      if (family) roles = roles.filter((role) => role.role === family);
      if (remote === "true") roles = roles.filter((role) => role.job.isRemote);
      if (location) roles = roles.filter((role) => role.job.location.toLowerCase().includes(location));
      if (seniority === "entry" || seniority === "mid" || seniority === "senior") {
        roles = roles.filter((role) => roleSeniority(role) === seniority);
      }
      if (sector) roles = roles.filter((role) => role.category?.toLowerCase().includes(sector));
      if (Number.isFinite(minimumScore) && minimumScore > 0) {
        roles = roles.filter((role) => role.score >= minimumScore);
      }
      roles = roles.filter((role) =>
        (included.has("hidden") || !role.state?.hidden)
        && (included.has("applied") || !role.state?.applied),
      );
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
    if (request.method === "DELETE" && applicationMatch) {
      const domain = decodeURIComponent(applicationMatch[1]!);
      const externalId = decodeURIComponent(applicationMatch[2]!);
      return store.deleteApplication(domain, externalId)
        ? json({ deleted: true })
        : json({ error: "Application not found." }, 404);
    }
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
