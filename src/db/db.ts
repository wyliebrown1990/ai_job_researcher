// SQLite state store (bun:sqlite). This file is the committed audit trail of the
// watchlist. Complex sub-objects are stored as JSON columns; the canonical company
// key is the normalized domain (E4).

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  Application,
  ApplicationStatus,
  Company,
  FundingEvent,
  JobPosting,
  ReviewItem,
  RoleState,
  SearchProfile,
  Snapshot,
} from "../types.ts";
import { config } from "../config.ts";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS companies (
  domain        TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'watching',
  data          TEXT NOT NULL,           -- full Company JSON
  score         INTEGER,                 -- denormalized for cheap querying
  bucket        TEXT,
  first_seen    TEXT NOT NULL,
  last_updated  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_companies_score ON companies(score DESC);
CREATE INDEX IF NOT EXISTS idx_companies_updated ON companies(last_updated);

CREATE TABLE IF NOT EXISTS review_queue (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  domain     TEXT,
  name       TEXT NOT NULL,
  reason     TEXT NOT NULL,
  data       TEXT NOT NULL,             -- full ReviewItem JSON
  created_at TEXT NOT NULL,
  resolved   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  run_date     TEXT NOT NULL,           -- YYYY-MM-DD (idempotency key, design §6)
  started_at   TEXT NOT NULL,
  finished_at  TEXT,
  summary      TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_runs_date ON runs(run_date);

CREATE TABLE IF NOT EXISTS snapshots (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  domain               TEXT NOT NULL,
  run_date             TEXT NOT NULL,
  score                INTEGER,
  bucket               TEXT,
  confidence           TEXT,
  open_roles_count     INTEGER,
  matching_roles_count INTEGER,
  funding_total_usd    INTEGER,
  created_at           TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_snapshots_domain_date ON snapshots(domain, run_date);

CREATE TABLE IF NOT EXISTS funding_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  domain         TEXT NOT NULL,
  stage          TEXT NOT NULL,
  amount_usd     INTEGER,
  valuation_usd  INTEGER,
  announced_date TEXT NOT NULL,
  data           TEXT NOT NULL,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_funding_events_domain_date ON funding_events(domain, announced_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_funding_events_unique
  ON funding_events(domain, announced_date, IFNULL(amount_usd, -1));

CREATE TABLE IF NOT EXISTS search_profile (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  data       TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS role_state (
  domain       TEXT NOT NULL,
  external_id  TEXT NOT NULL,
  saved        INTEGER NOT NULL DEFAULT 0,
  hidden       INTEGER NOT NULL DEFAULT 0,
  applied      INTEGER NOT NULL DEFAULT 0,
  fit_override TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (domain, external_id)
);

CREATE TABLE IF NOT EXISTS applications (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  domain         TEXT NOT NULL,
  external_id    TEXT NOT NULL,
  status         TEXT NOT NULL,
  notes          TEXT NOT NULL DEFAULT '',
  next_action_at TEXT,
  applied_at     TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  UNIQUE(domain, external_id)
);
CREATE INDEX IF NOT EXISTS idx_applications_status_next_action ON applications(status, next_action_at);

CREATE TABLE IF NOT EXISTS role_cache (
  domain       TEXT NOT NULL,
  external_id  TEXT NOT NULL,
  data         TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  PRIMARY KEY (domain, external_id)
);
CREATE INDEX IF NOT EXISTS idx_role_cache_domain ON role_cache(domain);
`;

type CompanyRow = { data: string; pinned: number; notes: string | null };

function defaultSearchProfile(): SearchProfile {
  return {
    targetRoles: Object.keys(config.targetRoles) as SearchProfile["targetRoles"],
    customTitlePhrases: [],
    acceptedLocations: [],
    remotePreference: "any",
    includedSectors: [],
    sectorPreferenceStrength: "required",
    businessModelThemes: [],
    preferredStages: [],
    stagePreferenceStrength: "preferred",
    preferredTeamSizes: [],
    teamSizePreferenceStrength: "preferred",
    excludedCompanyDomains: [],
    equityPriority: "not-a-factor",
    compensationNote: "",
    signalInterests: [],
    searchBrief: "",
    excludedKeywords: [],
    minCompanyScore: 0,
    updatedAt: "",
  };
}

function canonicalizeLocations(locations: string[] | undefined): string[] {
  if (!locations) return [];
  return [...new Set(locations.map((location) => {
    const normalized = location.trim().toLowerCase();
    return config.locationOptions.find((option) =>
      option.toLowerCase() === normalized || option.toLowerCase().startsWith(`${normalized},`),
    ) ?? location;
  }))];
}

export class Store {
  readonly db: Database;

  constructor(path = config.dbPath) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(SCHEMA);
    this.ensureColumn("companies", "pinned", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("companies", "notes", "TEXT");
  }

  private ensureColumn(table: "companies", column: "pinned" | "notes", definition: string): void {
    const columns = this.db.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all();
    if (!columns.some((item) => item.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  private toCompany(row: CompanyRow | null): Company | null {
    if (!row) return null;
    return { ...JSON.parse(row.data) as Company, pinned: Boolean(row.pinned), notes: row.notes ?? undefined };
  }

  getCompany(domain: string): Company | null {
    const row = this.db.query<CompanyRow, [string]>(
      "SELECT data, pinned, notes FROM companies WHERE domain = ?",
    ).get(domain);
    return this.toCompany(row);
  }

  upsertCompany(c: Company): void {
    this.db.query(
      `INSERT INTO companies (domain, display_name, status, data, score, bucket, first_seen, last_updated, pinned, notes)
       VALUES ($domain, $name, $status, $data, $score, $bucket, $firstSeen, $lastUpdated, COALESCE($pinned, 0), $notes)
       ON CONFLICT(domain) DO UPDATE SET
         display_name = $name, status = $status, data = $data,
         score = $score, bucket = $bucket, last_updated = $lastUpdated,
         pinned = COALESCE($pinned, companies.pinned), notes = COALESCE($notes, companies.notes)`,
    ).run({
      $domain: c.domain,
      $name: c.displayName,
      $status: c.status,
      $data: JSON.stringify(c),
      $score: c.score?.score ?? null,
      $bucket: c.score?.bucket ?? null,
      $firstSeen: c.firstSeen,
      $lastUpdated: c.lastUpdated,
      $pinned: c.pinned === undefined ? null : Number(c.pinned),
      $notes: c.notes ?? null,
    });
  }

  allCompanies(): Company[] {
    return this.db.query<CompanyRow, []>("SELECT data, pinned, notes FROM companies ORDER BY score DESC")
      .all().map((r) => this.toCompany(r)!);
  }

  /** Companies whose last_updated is older than the staleness window. */
  staleCompanies(now = new Date()): Company[] {
    const cutoff = new Date(now.getTime() - config.staleness.defaultDays * 86_400_000).toISOString();
    return this.db.query<CompanyRow, [string]>(
      "SELECT data, pinned, notes FROM companies WHERE status != 'archived' AND last_updated < ? ORDER BY last_updated",
    ).all(cutoff).map((r) => this.toCompany(r)!);
  }

  setPinned(domain: string, pinned: boolean): void {
    this.db.query("UPDATE companies SET pinned = ? WHERE domain = ?").run(Number(pinned), domain);
  }

  setNotes(domain: string, notes: string): void {
    this.db.query("UPDATE companies SET notes = ? WHERE domain = ?").run(notes, domain);
  }

  writeSnapshot(company: Company, runDate: string, matchingRolesCount = 0): void {
    this.db.query(
      `INSERT INTO snapshots (domain, run_date, score, bucket, confidence, open_roles_count, matching_roles_count, funding_total_usd, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(domain, run_date) DO UPDATE SET
         score = excluded.score, bucket = excluded.bucket, confidence = excluded.confidence,
         open_roles_count = excluded.open_roles_count, matching_roles_count = excluded.matching_roles_count,
         funding_total_usd = excluded.funding_total_usd, created_at = excluded.created_at`,
    ).run(
      company.domain,
      runDate,
      company.score?.score ?? null,
      company.score?.bucket ?? null,
      company.score?.confidence ?? null,
      company.openRolesCount ?? null,
      matchingRolesCount,
      company.totalRaisedUsd ?? null,
      new Date().toISOString(),
    );
  }

  snapshotsFor(domain: string): Snapshot[] {
    return this.db.query<{
      domain: string; run_date: string; score: number | null; bucket: Snapshot["bucket"] | null;
      confidence: Snapshot["confidence"] | null; open_roles_count: number | null;
      matching_roles_count: number | null; funding_total_usd: number | null; created_at: string;
    }, [string]>(
      "SELECT domain, run_date, score, bucket, confidence, open_roles_count, matching_roles_count, funding_total_usd, created_at FROM snapshots WHERE domain = ? ORDER BY run_date",
    ).all(domain).map((row) => ({
      domain: row.domain,
      runDate: row.run_date,
      score: row.score ?? undefined,
      bucket: row.bucket ?? undefined,
      confidence: row.confidence ?? undefined,
      openRolesCount: row.open_roles_count ?? undefined,
      matchingRolesCount: row.matching_roles_count ?? undefined,
      fundingTotalUsd: row.funding_total_usd ?? undefined,
      createdAt: row.created_at,
    }));
  }

  appendFundingEvent(domain: string, event: FundingEvent): void {
    this.db.query(
      `INSERT OR IGNORE INTO funding_events (domain, stage, amount_usd, valuation_usd, announced_date, data, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      domain,
      event.stage,
      event.amountUsd ?? null,
      event.valuationUsd ?? null,
      event.announcedDate,
      JSON.stringify(event),
      new Date().toISOString(),
    );
  }

  fundingHistory(domain: string): FundingEvent[] {
    return this.db.query<{ data: string }, [string]>(
      "SELECT data FROM funding_events WHERE domain = ? ORDER BY announced_date",
    ).all(domain).map((row) => JSON.parse(row.data) as FundingEvent);
  }

  getSearchProfile(): SearchProfile {
    const row = this.db.query<{ data: string; updated_at: string }, []>(
      "SELECT data, updated_at FROM search_profile WHERE id = 1",
    ).get();
    if (!row) return defaultSearchProfile();
    const profile = { ...defaultSearchProfile(), ...JSON.parse(row.data) as Partial<SearchProfile>, updatedAt: row.updated_at };
    return { ...profile, acceptedLocations: canonicalizeLocations(profile.acceptedLocations) };
  }

  saveSearchProfile(profile: Partial<Omit<SearchProfile, "updatedAt">>): SearchProfile {
    const saved: SearchProfile = { ...defaultSearchProfile(), ...profile, updatedAt: new Date().toISOString() };
    this.db.query(
      `INSERT INTO search_profile (id, data, updated_at) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    ).run(JSON.stringify(saved), saved.updatedAt);
    return saved;
  }

  getRoleState(domain: string, externalId: string): RoleState | null {
    const row = this.db.query<{
      domain: string; external_id: string; saved: number; hidden: number; applied: number;
      fit_override: RoleState["fitOverride"] | null; created_at: string; updated_at: string;
    }, [string, string]>(
      "SELECT domain, external_id, saved, hidden, applied, fit_override, created_at, updated_at FROM role_state WHERE domain = ? AND external_id = ?",
    ).get(domain, externalId);
    if (!row) return null;
    return {
      domain: row.domain, externalId: row.external_id, saved: Boolean(row.saved), hidden: Boolean(row.hidden),
      applied: Boolean(row.applied), fitOverride: row.fit_override ?? undefined,
      createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }

  recentRoleStates(limit = 20): RoleState[] {
    return this.db.query<{
      domain: string; external_id: string; saved: number; hidden: number; applied: number;
      fit_override: RoleState["fitOverride"] | null; created_at: string; updated_at: string;
    }, [number]>(
      "SELECT domain, external_id, saved, hidden, applied, fit_override, created_at, updated_at FROM role_state ORDER BY updated_at DESC LIMIT ?",
    ).all(limit).map((row) => ({
      domain: row.domain, externalId: row.external_id, saved: Boolean(row.saved), hidden: Boolean(row.hidden),
      applied: Boolean(row.applied), fitOverride: row.fit_override ?? undefined,
      createdAt: row.created_at, updatedAt: row.updated_at,
    }));
  }

  upsertRoleState(
    domain: string,
    externalId: string,
    patch: Partial<Pick<RoleState, "saved" | "hidden" | "applied" | "fitOverride">>,
  ): RoleState {
    const current = this.getRoleState(domain, externalId);
    const now = new Date().toISOString();
    const next: RoleState = {
      domain,
      externalId,
      saved: patch.saved ?? current?.saved ?? false,
      hidden: patch.hidden ?? current?.hidden ?? false,
      applied: patch.applied ?? current?.applied ?? false,
      fitOverride: patch.fitOverride ?? current?.fitOverride,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    };
    this.db.query(
      `INSERT INTO role_state (domain, external_id, saved, hidden, applied, fit_override, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(domain, external_id) DO UPDATE SET
         saved = excluded.saved, hidden = excluded.hidden, applied = excluded.applied,
         fit_override = excluded.fit_override, updated_at = excluded.updated_at`,
    ).run(
      next.domain, next.externalId, Number(next.saved), Number(next.hidden), Number(next.applied),
      next.fitOverride ?? null, next.createdAt, next.updatedAt,
    );
    return next;
  }

  createApplication(
    input: Omit<Application, "id" | "createdAt" | "updatedAt">,
  ): Application {
    const now = new Date().toISOString();
    this.db.query(
      `INSERT INTO applications (domain, external_id, status, notes, next_action_at, applied_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(domain, external_id) DO UPDATE SET
         status = excluded.status, notes = excluded.notes, next_action_at = excluded.next_action_at,
         applied_at = excluded.applied_at, updated_at = excluded.updated_at`,
    ).run(
      input.domain, input.externalId, input.status, input.notes, input.nextActionAt ?? null,
      input.appliedAt ?? null, now, now,
    );
    return this.applicationFor(input.domain, input.externalId)!;
  }

  updateApplication(
    domain: string,
    externalId: string,
    patch: Partial<Pick<Application, "status" | "notes" | "nextActionAt" | "appliedAt">>,
  ): Application | null {
    const current = this.applicationFor(domain, externalId);
    if (!current) return null;
    return this.createApplication({
      domain,
      externalId,
      status: patch.status ?? current.status,
      notes: patch.notes ?? current.notes,
      nextActionAt: patch.nextActionAt ?? current.nextActionAt,
      appliedAt: patch.appliedAt ?? current.appliedAt,
    });
  }

  deleteApplication(domain: string, externalId: string): boolean {
    return this.db.query(
      "DELETE FROM applications WHERE domain = ? AND external_id = ?",
    ).run(domain, externalId).changes > 0;
  }

  applicationFor(domain: string, externalId: string): Application | null {
    const row = this.db.query<{
      id: number; domain: string; external_id: string; status: ApplicationStatus; notes: string;
      next_action_at: string | null; applied_at: string | null; created_at: string; updated_at: string;
    }, [string, string]>(
      "SELECT id, domain, external_id, status, notes, next_action_at, applied_at, created_at, updated_at FROM applications WHERE domain = ? AND external_id = ?",
    ).get(domain, externalId);
    if (!row) return null;
    return {
      id: row.id, domain: row.domain, externalId: row.external_id, status: row.status, notes: row.notes,
      nextActionAt: row.next_action_at ?? undefined, appliedAt: row.applied_at ?? undefined,
      createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }

  applications(): Application[] {
    return this.db.query<{ domain: string; external_id: string }, []>(
      "SELECT domain, external_id FROM applications ORDER BY updated_at DESC, id DESC",
    ).all().map((row) => this.applicationFor(row.domain, row.external_id)!);
  }

  replaceCachedJobs(domain: string, jobs: JobPosting[]): void {
    const write = this.db.transaction(() => {
      this.db.query("DELETE FROM role_cache WHERE domain = ?").run(domain);
      const insert = this.db.query(
        "INSERT INTO role_cache (domain, external_id, data, retrieved_at) VALUES (?, ?, ?, ?)",
      );
      for (const job of jobs) insert.run(domain, job.externalId, JSON.stringify(job), job.retrievedAt);
    });
    write();
  }

  cachedJobs(domain: string): JobPosting[] {
    return this.db.query<{ data: string }, [string]>(
      "SELECT data FROM role_cache WHERE domain = ? ORDER BY retrieved_at DESC, external_id",
    ).all(domain).map((row) => JSON.parse(row.data) as JobPosting);
  }

  addReviewItem(item: ReviewItem): void {
    this.db.query(
      `INSERT INTO review_queue (domain, name, reason, data, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(item.domain ?? null, item.displayName, item.reason, JSON.stringify(item), item.createdAt);
  }

  openReviewItems(): ReviewItem[] {
    return this.db.query<{ data: string }, []>(
      "SELECT data FROM review_queue WHERE resolved = 0 ORDER BY created_at DESC",
    ).all().map((r) => JSON.parse(r.data) as ReviewItem);
  }

  openReviewRows(): { id: number; item: ReviewItem }[] {
    return this.db.query<{ id: number; data: string }, []>(
      "SELECT id, data FROM review_queue WHERE resolved = 0 ORDER BY created_at DESC",
    ).all().map((row) => ({ id: row.id, item: JSON.parse(row.data) as ReviewItem }));
  }

  resolveReviewItem(id: number): boolean {
    return this.db.query("UPDATE review_queue SET resolved = 1 WHERE id = ? AND resolved = 0").run(id).changes > 0;
  }

  /** Idempotency (design §6): returns false if a run already completed today. */
  beginRun(runDate: string, startedAt: string): boolean {
    const existing = this.db.query<{ finished_at: string | null }, [string]>(
      "SELECT finished_at FROM runs WHERE run_date = ?",
    ).get(runDate);
    if (existing?.finished_at) return false;
    this.db.query(
      "INSERT INTO runs (run_date, started_at) VALUES (?, ?) ON CONFLICT(run_date) DO NOTHING",
    ).run(runDate, startedAt);
    return true;
  }

  finishRun(runDate: string, finishedAt: string, summary: string): void {
    this.db.query("UPDATE runs SET finished_at = ?, summary = ? WHERE run_date = ?")
      .run(finishedAt, summary, runDate);
  }

  close(): void {
    this.db.close();
  }
}
