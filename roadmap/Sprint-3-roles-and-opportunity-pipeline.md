# Sprint 3: Roles and Opportunity Pipeline

> **PROGRESS TRACKING**: Update this document as you complete tasks.
> Mark checkboxes `[x]` when done. Do NOT create separate status docs.
> Last updated: 2026-08-13 by Codex

## Overview

Turn matched openings into a focused personal job-search workspace. The Roles screen
helps Wylie decide what to save, hide, or pursue; the Pipeline retains the resulting
application context and next actions. This sprint deliberately avoids ATS submission,
email automation, and a full CRM.

## Tasks

### Role and pipeline API

- [x] Add `GET /api/roles` aggregating current profile-compatible matches across the
  watchlist. Rank by company growth and role-fit signal; keep `fit_caveat` visible.
- [x] Support filters for role family, seniority, location, remote, sector, company
  score, saved/applied state, and hidden roles. Preserve query state in the URL where
  inexpensive to do so.
- [x] Add validated role-state mutations for save, hide/unhide, and applied. Key all
  state by `domain + externalId`, and make repeated writes idempotent.
- [x] Add `GET /api/applications` and create/update routes for application status,
  notes, and a next-action date. Accept only bounded, expected fields.
- [x] Ensure a role’s applied state never changes the company’s `status`; a company may
  have several independently tracked roles.

### Roles workspace

- [x] Build a **Roles** screen with compact role cards/rows: company, role family,
  location/remote flag, posted date, company growth signal, fit caveat, and direct
  apply link.
- [x] Make the first decisions one-click: Save, Hide, and Add to pipeline. Confirm the
  saved state after each mutation rather than relying solely on optimistic UI.
- [x] Provide useful empty states for restrictive profile filters, no current matches,
  and all roles hidden/applied.
- [x] Default to live, unapplied, unhidden roles. Let the user intentionally include
  saved/applied/hidden records for review.

### Opportunity pipeline

- [x] Build a **Pipeline** view grouped by simple statuses: researching, networking,
  applied, interviewing, closed. Keep these statuses local and editable.
- [x] Show the exact role, company, applied date, latest notes, and next action—not a
  generic company card.
- [x] Add inline status, notes, and next-action editing with clear save/error feedback.
- [x] Surface next actions due or overdue at the top of Today in the next dashboard
  refresh; do not introduce system notifications yet.

### Daily-loop feedback

- [x] Exclude hidden and applied individual roles from the default digest role section
  while continuing to scan and display other matches from the same company.
- [x] Add a small “saved roles / next actions” digest section only when there is a
  meaningful change or due action. Keep the daily email scannable.
- [x] Preserve the raw current ATS match list in the database response so a changed
  profile or unhidden role can be reevaluated without stale UI-only data.

## Browser Testing & Validation (agent-browser CLI)

> **MANDATORY**: Use agent-browser CLI to manually test all web features. Do NOT mark
> web-related tasks complete without performing browser validation.

- [x] Open `http://127.0.0.1:3000`, navigate to Roles, and take an initial screenshot.
- [x] Run `agent-browser snapshot -i`; apply at least one role and location/remote
  filter, then confirm the results and empty state are intelligible.
- [x] Save, hide, and add a real role to the pipeline using interactive element refs;
  reload to confirm persistence and capture screenshots.
- [x] Inspect `state/ajr.db` to verify the `role_state` and `applications` rows match
  the UI actions.
- [x] Confirm applying one role does not remove a second matching role at the same
  company from the default Roles view.
- [x] Edit a next action, verify its Today appearance, and capture a final screenshot.
- [x] Document screenshots and any issues in this file before requesting human review.

## Infrastructure and Cost Constraints

- [x] Use existing local SQLite and localhost server only; do not add a hosted task
  manager, CRM, background worker, or paid integration.

## Acceptance Criteria

- [x] Roles can be filtered to a small, credible, personally relevant queue.
- [x] Save/hide/apply actions are stable role-level records and survive server restarts.
- [x] Pipeline entries retain useful context and next actions without introducing CRM scope.
- [x] The digest and Today honor role-level user intent without hiding other company roles.
- [x] Browser validation covers filters, mutation persistence, and the same-company edge case.

## Notes for Future Developers

- “Applied” is an application fact, not a company lifecycle status. Keep the distinction
  even if a later UI offers a convenient company-level research label.
- Do not scrape job descriptions beyond existing ATS fetches just to enrich cards;
  keep the role list fast and evidence-backed.

## Validation Evidence

- 2026-08-13: `bun run typecheck && bun test` passed: 51 tests, 0 failures.
- Browser validation used `http://127.0.0.1:3012` (the same localhost app on an alternate
  port because existing local previews occupied 3000). Captures: `/tmp/ajr-s3-roles-loaded.png`,
  `/tmp/ajr-s3-role-filters.png`, `/tmp/ajr-s3-role-actions.png`,
  `/tmp/ajr-s3-pipeline-next-action.png`, and `/tmp/ajr-s3-today-next-actions.png`.
- A HappyRobot FDE was saved, added to Pipeline, moved to Applied with a due action, and
  surfaced in Today. A second HappyRobot role remained visible. Temporary records were
  restored after validation; final SQLite checks show zero application rows and false flags.
- Final closure: posted-date metadata was verified in `/tmp/ajr-s3-posted-dates.png`;
  current daily scans cache raw ATS postings in SQLite; browser mutation failures now
  show a retry toast. The final verification run passed 52 tests with 0 failures.
