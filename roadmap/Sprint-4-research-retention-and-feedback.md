# Sprint 4: Research Retention and Feedback Loop

> **PROGRESS TRACKING**: Update this document as you complete tasks.
> Mark checkboxes `[x]` when done. Do NOT create separate status docs.
> Last updated: 2026-08-13 by Codex

## Overview

Close the loop between discovery, personal research, and the daily digest. Make
followed companies affect refresh/digest behavior, turn the review queue into a quick
triage surface, retain past digests, and finish the rough edges that make the tool
pleasant to return to every day.

## Tasks

### Followed-company feedback

- [ ] Make pinned companies bypass the normal staleness window, receive a refresh on
  each daily run within the existing fetch budget, and never auto-archive.
- [x] Add a concise “Following” digest section containing material score, funding,
  hiring, or target-role changes for pinned companies.
- [x] Add a simple manual “add company” flow: validate domain/name, detect an existing
  supported ATS where possible, create a pinned watchlist record, and score it on the
  next run rather than blocking the UI on live enrichment.
- [x] Make failure states explicit when an ATS cannot be detected; allow the company to
  remain a research note rather than pretending it has live role coverage.

### Review and archive

- [x] Build a **Review** screen grouped by reason, with clear promote, resolve, and
  dismiss actions. Promotion requires a real domain or closed-round evidence; never
  guess a canonical domain.
- [x] Build a **Research** archive that lists prior committed digests and renders a
  selected day locally.
- [ ] Add concise links from digest/company history to relevant archived reports when
  the source exists, without duplicating the full digest content into SQLite.
- [x] Retain explicit empty states for an empty review queue and a fresh installation
  with no archive.

### Product polish

- [ ] Add a persistent “new since last visit” treatment for new companies, funding
  events, matching roles, and relevant role-state updates.
- [ ] Ensure Today and the digest prefer material changes over repeated unchanged facts.
- [ ] Complete responsive laptop and narrow-window layouts, keyboard navigation,
  page titles, clear loading/error states, and light/dark theme consistency.
- [x] Add a short local “How this works” page/section that explains score confidence,
  evidence, profile filters, and the local-only data boundary.

### Quality and documentation

- [ ] Run `bun run typecheck` and `bun test`; add regression tests for pin refresh,
  role-level digest exclusion, review promotion validation, and archive API behavior.
- [x] Update `README.md` and `src/README.md` with `scan serve`, the dashboard’s local
  address, profile behavior, and backup location for local state.
- [ ] Keep `roadmap/PLAN.md` and this sprint guide as the only planning/status record;
  update checkbox evidence here as work lands.

## Browser Testing & Validation (agent-browser CLI)

> **MANDATORY**: Use agent-browser CLI to manually test all web features. Do NOT mark
> web-related tasks complete without performing browser validation.

- [x] Open `http://127.0.0.1:3000` and capture initial Review and Research screenshots.
- [x] Use `agent-browser snapshot -i` to find promotion/dismissal, archive, and add-
  company controls; exercise their primary flows with interactive refs.
- [x] Confirm promotions, dismissals, notes, and a manually added company in
  `state/ajr.db`; reload and capture persisted UI state.
- [ ] Run the daily loop and verify a pinned company is refreshed within the current
  fetch budget and relevant changes appear in the digest's Following section.
- [ ] Verify “new since last visit” resets/updates predictably after revisiting and
  capture final screenshots of Today, Review, and Research.
- [ ] Document screenshots and any failures in this sprint document before asking for
  human assistance.

## Infrastructure and Cost Constraints

- [x] Confirm the final tool remains localhost-bound and uses no new cloud services.
- [x] Do not create AWS resources or seek cost approval because none are needed for the
  approved local-first scope; if this changes, stop and obtain approval first.

## Acceptance Criteria

- [ ] Following a company has a visible, useful effect on scanning and the digest.
- [ ] Review items can be safely promoted or dismissed, and historical digests remain
  browsable locally.
- [ ] The dashboard explains its signals and supports repeat daily use without noisy
  duplicate information.
- [ ] All browser flows have screenshot/state evidence and automated tests pass.

## Notes for Future Developers

- This sprint completes a high-value local tool. Remote access, user accounts,
  notifications, integrations, and open-source packaging are separate follow-on work.
- Keep “fast to ship” from becoming “unclear to use”: concise empty/error states and
  evidence provenance are non-negotiable even in a personal tool.

## Validation Evidence

- 2026-08-13: `bun run typecheck && bun test` passed: 54 tests, 0 failures.
- Research and Review screenshots: `/tmp/ajr-research.png`, `/tmp/ajr-review.png`,
  `/tmp/ajr-s4-review-grouped.png`, and `/tmp/ajr-s4-review-actions.png`.
  Manual company add and product-help screenshots: `/tmp/ajr-s4-manual-company.png`
  and `/tmp/ajr-s4-how-it-works.png`.
- The manual company validation used a disposable `qa-sprint4.invalid` record, then
  removed its exact local rows after checking that it was pinned and displayed.
- A disposable Review promote/dismiss pair was exercised with interactive browser
  controls; both rows resolved, the promoted pinned company was confirmed, and all
  exact test rows were removed afterward.
- Following digest regression coverage verifies unchanged pinned companies are omitted;
  the local server remains bound to `127.0.0.1` with no new services provisioned.
