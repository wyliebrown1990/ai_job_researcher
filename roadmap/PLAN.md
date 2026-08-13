# AI Career Intelligence Console — Development Plan

> **PROGRESS TRACKING**: This is the master plan. Update sprint docs as you work.
> Mark checkboxes in sprint files. Do NOT create separate status documents.
> Last updated: 2026-08-13 by Codex

## Project Overview

Evolve `ai_job_researcher` from a daily email digest into a fast, local personal
career-intelligence console. The email remains a useful nudge; the localhost dashboard
is the place to tune what matters, understand AI-industry signals, retain research,
and move individual job opportunities through a lightweight application workflow.

This is a single-user tool running on the user's Mac. Optimize for shipping useful
flows with Bun, SQLite, and a dependency-free browser UI. It is intentionally not a
multi-user SaaS, hosted product, or production-grade CRM.

## Product Principles

- [ ] Make the **Today** view answer “what changed and what should I do?” in a few minutes.
- [ ] Let a personal search profile control role relevance before results reach the digest.
- [ ] Track applications at the **role level**, never by hiding an entire company after one application.
- [ ] Show sourced evidence and changes over time so funding hype is distinguishable from signal.
- [ ] Keep every important personal decision (follow, save, pass, note, next step) in local SQLite.
- [ ] Keep the implementation local, buildless, and low-maintenance; defer auth, sync, collaboration, and cloud hosting.

## Sprint Overview

| Sprint | Focus | Status |
|---|---|---|
| Sprint 1 | Personal signal foundation — history, preferences, role-level state | Not Started |
| Sprint 2 | Today dashboard and company intelligence | Not Started |
| Sprint 3 | Roles workspace and personal opportunity pipeline | Not Started |
| Sprint 4 | Follow-up loop, review triage, research retention, and polish | Not Started |

## Experience Map

```text
Today                         Explore                         Manage
────────                      ───────                        ──────
Morning briefing              Companies                      Opportunity pipeline
What changed                  Company evidence & trends      Search profile
What needs action             Roles                           Review queue
                              Digest archive
```

## Architecture Decisions

- **Local server only.** `Bun.serve` binds to `127.0.0.1`; no authentication or
  hosted deployment is in scope. If remote access is later desired, design auth and
  CSRF protection then rather than prematurely adding them now.
- **SQLite remains the source of live state.** The dashboard only reads and writes
  through `Store`; no browser-local state is canonical. `localStorage` is acceptable
  only for presentation state such as last visit or theme.
- **The search profile is data, not TypeScript configuration.** Keep defaults in
  `src/config.ts`, but persist Wylie's active role families, seniority, locations,
  remote preference, sector interests, exclusions, and thresholds in SQLite.
- **A job opportunity is distinct from a company.** Stable `domain + externalId`
  keys preserve saved, hidden, applied, and follow-up state for one listing without
  changing the status of other roles at that company.
- **The daily loop owns discovery and scoring.** The dashboard must not independently
  compute company growth scores or scrape external sites; it displays stored results
  and writes user intent back for the next run.
- **Use plain HTML, CSS, and JavaScript served by Bun.** No framework, CDN, or build
  step. Inline SVG is sufficient for small history charts.
- **No new paid infrastructure.** Do not provision AWS or other cloud resources for
  this roadmap; this local tool should remain $0 beyond existing API/email usage.

## Data Model Direction

| Concern | Persistent model | Why it matters |
|---|---|---|
| Personal relevance | Singleton `search_profile` | Makes the daily role list reflect actual constraints and preferences. |
| Company history | `snapshots`, `funding_events` | Supports trend charts and trustworthy “what changed” signals. |
| Following a company | `companies.pinned`, `companies.notes` | Keeps intentional research distinct from passive discovery. |
| A role action | `role_state` keyed by `domain + externalId` | A saved/applied role does not hide its company's other openings. |
| An application | `applications` linked to role state | Retains status, notes, next action, and history without building a full CRM. |

## Dependencies

- [ ] Bun's built-in `Bun.serve` and `bun:sqlite` only; add no frontend package unless a later sprint proves it is needed.
- [ ] Existing ATS fetchers remain the source of roles; do not broaden scraping scope in this project plan.
- [ ] Existing `state/ajr.db` must receive idempotent, non-destructive migrations.
- [ ] `agent-browser` CLI is required for every dashboard validation flow.

## Explicitly Deferred

- [ ] Cloud hosting, login/authentication, multi-user accounts, collaboration, and mobile access.
- [ ] Automated application submission, recruiter outreach, calendar/email integrations, and resume generation.
- [ ] Rich CRM features such as contact syncing, activity sequences, and full-text document storage.
- [ ] Reconstructing history from before the history migration ships.

## Notes for Future Developers

- The current email digest remains a delivery channel. Once this roadmap is complete,
  it should link mentally to the dashboard's Today view rather than duplicate a
  separate product.
- There is no repository `AGENTS.md` or `CLAUDE.md` at planning time. The project
  profile in `.claude/project-profile.md`, `README.md`, and `docs/AGENT_LOOP_DESIGN.md`
  are the relevant local context.
