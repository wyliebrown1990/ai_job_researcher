# Sprint 1: Personal Signal Foundation

> **PROGRESS TRACKING**: Update this document as you complete tasks.
> Mark checkboxes `[x]` when done. Do NOT create separate status docs.
> Last updated: 2026-08-13 by Codex

## Overview

Build the small, durable data model that makes the dashboard personal instead of a
read-only digest. Add history for company signals, a persisted search profile, and
role-level user state/application records. This sprint intentionally ships no browser
UI; it establishes safe, testable `Store` methods and wires the profile into the
existing daily matching path.

## Tasks

### Idempotent SQLite migrations

- [ ] Back up the existing `state/ajr.db` before exercising migrations; never delete
  or recreate user state as part of a migration.
- [ ] Add `snapshots` with one row per `domain + run_date`: score, bucket, confidence,
  open-role count, matching-role count, funding total, and creation timestamp.
- [ ] Add `funding_events`, deduplicated by `domain + announced_date + amount_usd`, to
  retain distinct closed rounds separately from the current company JSON.
- [ ] Add `pinned INTEGER DEFAULT 0` and `notes TEXT` columns to `companies`.
- [ ] Add a singleton `search_profile` table. Store role families, seniority range,
  acceptable locations, remote policy, included sectors, excluded keywords, and
  result thresholds as JSON with `updated_at`.
- [ ] Add `role_state` keyed by `domain + external_id`; persist `saved`, `hidden`,
  `applied`, optional fit override, and timestamps.
- [ ] Add `applications` keyed by a local id and linked to `domain + external_id`;
  retain status, notes, next-action date, and timestamps. Keep it intentionally
  lightweight—no separate contacts or activity system.
- [ ] Use `CREATE TABLE IF NOT EXISTS` and guarded column additions so an existing
  state database migrates without loss.

### Store API and types

- [ ] Add `Snapshot`, `SearchProfile`, `RoleState`, and `Application` types in
  `src/types.ts`, using explicit enums for remote preference and application status.
- [ ] Implement and test `writeSnapshot`, `snapshotsFor`, `appendFundingEvent`, and
  `fundingHistory`.
- [ ] Implement and test `getSearchProfile` and `saveSearchProfile`, returning sensible
  defaults when a profile has not yet been customized.
- [ ] Implement and test `setPinned`, `setNotes`, role-state upsert/read methods, and
  application create/update/list methods.
- [ ] Ensure every repository method is parameterized and accessed only through
  `Store`; API handlers in later sprints must not issue ad-hoc SQLite queries.

### Daily-loop integration

- [ ] Write one snapshot for each scored company on every successful run; seed an
  initial snapshot for existing companies on the first run after migration.
- [ ] Append verified closed funding rounds during ingest without duplicating prior
  rounds.
- [ ] Apply the persisted search profile when filtering and ranking role matches.
  Preserve `src/config.ts` as a documented default/fallback, not the sole way to
  tune a personal search.
- [ ] Continue to emit honest `fit_caveat` values; a profile filter must not turn an
  adjacent role into a claimed perfect fit.

### Verification

- [ ] Run `bun run typecheck` and `bun test`; add focused tests for every new `Store`
  method and profile-driven matching behavior.
- [ ] Run `bun run scan run --force`, then read `snapshots` and `funding_events` from
  `state/ajr.db` to confirm rows were persisted and funding rows are idempotent on a
  second forced run.
- [ ] Save a profile with a restrictive role/location setting and confirm the next
  role-match output excludes incompatible jobs while retaining the original live ATS
  posting data.
- [ ] Create, update, and reread a role state and application directly through the
  `Store` test harness; confirm a role application does not change its company's status.

## Infrastructure and Cost Constraints

- [ ] Confirm no AWS, hosted database, auth provider, or new billable service is being
  introduced; document the local-only `$0` infrastructure decision in the PR/commit.

## Acceptance Criteria

- [ ] Existing databases migrate non-destructively.
- [ ] Company snapshots and funding history retain useful chronological data.
- [ ] The search profile changes which roles are surfaced by the daily loop.
- [ ] Role-level saved/applied state survives process restarts and does not suppress
  unrelated roles at the same company.
- [ ] Tests and SQLite read evidence are recorded in this document.

## Notes for Future Developers

- History begins at rollout. Do not invent or backfill historical scores from old
  digests.
- Keep the profile lean until real use shows a missing control. A local tool benefits
  from a few high-confidence filters more than a complicated settings taxonomy.
