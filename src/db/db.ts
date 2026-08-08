// SQLite state store (bun:sqlite). This file is the committed audit trail of the
// watchlist. Complex sub-objects are stored as JSON columns; the canonical company
// key is the normalized domain (E4).

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Company, ReviewItem } from "../types.ts";
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
`;

export class Store {
  readonly db: Database;

  constructor(path = config.dbPath) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(SCHEMA);
  }

  getCompany(domain: string): Company | null {
    const row = this.db.query<{ data: string }, [string]>(
      "SELECT data FROM companies WHERE domain = ?",
    ).get(domain);
    return row ? (JSON.parse(row.data) as Company) : null;
  }

  upsertCompany(c: Company): void {
    this.db.query(
      `INSERT INTO companies (domain, display_name, status, data, score, bucket, first_seen, last_updated)
       VALUES ($domain, $name, $status, $data, $score, $bucket, $firstSeen, $lastUpdated)
       ON CONFLICT(domain) DO UPDATE SET
         display_name = $name, status = $status, data = $data,
         score = $score, bucket = $bucket, last_updated = $lastUpdated`,
    ).run({
      $domain: c.domain,
      $name: c.displayName,
      $status: c.status,
      $data: JSON.stringify(c),
      $score: c.score?.score ?? null,
      $bucket: c.score?.bucket ?? null,
      $firstSeen: c.firstSeen,
      $lastUpdated: c.lastUpdated,
    });
  }

  allCompanies(): Company[] {
    return this.db.query<{ data: string }, []>("SELECT data FROM companies ORDER BY score DESC")
      .all().map((r) => JSON.parse(r.data) as Company);
  }

  /** Companies whose last_updated is older than the staleness window. */
  staleCompanies(now = new Date()): Company[] {
    const cutoff = new Date(now.getTime() - config.staleness.defaultDays * 86_400_000).toISOString();
    return this.db.query<{ data: string }, [string]>(
      "SELECT data FROM companies WHERE status != 'archived' AND last_updated < ? ORDER BY last_updated",
    ).all(cutoff).map((r) => JSON.parse(r.data) as Company);
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
