# Sprint 2: Today and Company Intelligence

> **PROGRESS TRACKING**: Update this document as you complete tasks.
> Mark checkboxes `[x]` when done. Do NOT create separate status docs.
> Last updated: 2026-08-13 by Codex

## Overview

Ship the local browser surface for daily orientation and company research. The first
screen is **Today**, an action-oriented briefing—not a generic analytics dashboard.
Users can see meaningful changes since the prior visit, inspect companies, understand
the evidence behind a score, and edit the personal search profile. Write-back for
company follow/notes is included because it is a minimal, high-value research loop.

## Tasks

### Local server and read API

- [x] Add `src/server.ts` using `Bun.serve`, bound explicitly to `127.0.0.1` with
  port `3000` by default and a `scan serve [--port N]` CLI command.
- [x] Serve one self-contained SPA plus JSON endpoints. Use no CDN, frontend framework,
  or external browser requests.
- [x] Add `GET /api/today`: newly matched roles, company score/hiring/funding changes,
  pinned-company updates, outstanding application next actions, and review count.
- [x] Add `GET /api/companies` with score, change, bucket, hiring, funding, status, and
  pinned data plus bounded client-facing filter/sort parameters.
- [x] Add `GET /api/companies/:domain` with company record, snapshots, funding history,
  matching roles, and dated evidence.
- [x] Add `GET /api/profile`; add validated writes for profile, pin, and notes. Return
  persisted data from every mutation so the UI can reconcile optimistic state.

### Dashboard experience

- [x] Create a calm, responsive app shell with navigation for Today, Companies, Roles,
  Pipeline, Research, Review, and Preferences. Unshipped sections may show a precise
  “coming next” state rather than broken links.
- [x] Build **Today** as an ordered briefing: new relevant roles, meaningful company
  changes, followed-company updates, and next actions. Explain empty states in terms
  of what to do or when the next daily scan runs.
- [x] Build **Companies** as a sortable/filterable table or compact list that supports
  score, signal delta, category, funding recency, hiring, match count, and follow state.
- [x] Build **Company detail** with header, evidence-forward signal strip, score and
  open-role SVG charts, funding timeline, current relevant jobs, dated evidence,
  follow control, and notes.
- [x] Build **Preferences** around the actual personal decisions in Sprint 1: target
  role families, seniority, location/remote policy, sectors, exclusions, and minimum
  signal thresholds. Explain that changes affect subsequent scans, not past digests.
- [x] Use `localStorage` only for last-visit timestamp/theme. Show “new since your last
  visit” as a display convenience, while canonical information remains in SQLite.

### Presentation and accessibility

- [x] Use plain semantic HTML, visible keyboard focus, correctly associated form labels,
  and motion that respects reduced-motion preferences.
- [x] Implement loading, empty, and failure states for each route. Do not conceal an API
  error behind an empty list.
- [x] Use hand-rolled inline SVG charts with a “not enough history yet” state for fewer
  than two snapshots.

## Browser Testing & Validation (agent-browser CLI)

> **MANDATORY**: Use agent-browser CLI to manually test all web features. Do NOT mark
> web-related tasks complete without performing browser validation.

- [x] Start the server with `bun run scan serve`, then open `http://127.0.0.1:3000`.
- [x] Take initial Today and Companies screenshots: `agent-browser screenshot`.
- [x] Inspect interactive controls: `agent-browser snapshot -i`.
- [x] Open a company, verify chart/timeline/evidence values against the corresponding
  SQLite rows, and capture a Company detail screenshot.
- [x] Change a preference, pin a company, and save a note with `agent-browser click`
  and `agent-browser fill`; reload the page and confirm each persisted state.
- [x] Confirm the profile write persists across reload; capture final
  screenshots and document any issues in this file.

## Infrastructure and Cost Constraints

- [x] Confirm the server listens only on `127.0.0.1`, not `0.0.0.0`.
- [x] Confirm no AWS or other billable infrastructure was provisioned; port override
  is sufficient when `3000` is already occupied.

## Acceptance Criteria

- [x] Today gives a clear, real-data daily briefing and distinguishes new changes from
  unchanged watchlist noise.
- [x] Company and detail views make scores traceable to history and dated evidence.
- [x] Search preferences, follows, and notes persist in SQLite and survive a restart.
- [x] Browser validation includes screenshots and datastore comparisons.

## Validation Evidence

- [x] 2026-08-13: `bun run typecheck` and `bun test` passed (47 tests).
- [x] 2026-08-13: `bun run scan serve --port 3010` bound to `127.0.0.1`; the live
  Today and Baseten detail pages were inspected in agent-browser and captured at
  `/tmp/ajr-today.png` and `/tmp/ajr-company.png`.
- [x] 2026-08-13: profile writes, follow/unfollow, and notes were exercised in the
  visible UI. Reloaded Preferences retained `remote-only`; the profile was restored to
  `any` and Baseten's test note/follow state were cleared afterward.

## Notes for Future Developers

- Keep the visual vocabulary disciplined and evidence-forward. The dashboard is a
  personal research instrument, not a startup-metrics demo.
- Do not add login/auth just because mutations exist: localhost binding is the current
  security boundary. Revisit only with a real remote-access requirement.
