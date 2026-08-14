# Sprint 5: Search Criteria and Personal Relevance

> **PROGRESS TRACKING INSTRUCTIONS**
>
> - Mark tasks complete by changing [ ] to [x] only after implementation and validation.
> - Record decisions, screenshots, and failures in this file; do not create a separate status document.
> - Use agent-browser against the local dashboard before asking for human review.
>
> Last updated: 2026-08-14 by Codex

## Overview

**Goal**: Let a user express what a good next AI-industry role and company looks like, then apply that intent transparently to LLM discovery, role matching, company ranking, and the daily digest.

**Scope**: Extend the existing local search-profile JSON and Preferences route. Keep the current evidence-backed Growth Score intact, and introduce a separate personal relevance result rather than hiding objective company signals behind user preferences.

**Out of scope**: Accounts, collaboration, automatic application, compensation negotiation, a full resume parser, or claiming that equity/company-size facts are known when public evidence does not support them.

## Product Decisions

### A three-level intent model, not one giant prompt

Every optional criterion belongs to one of these lanes:

| Lane | Meaning | Result when absent or unknown |
|---|---|---|
| **Required** | A hard boundary, such as remote-only or a role/location the user cannot take. | Do not place the role in the primary role queue; explain why. |
| **Preferred** | A ranking signal, such as seed-to-Series-B, small teams, or meaningful equity. | Keep it visible, but rank it lower and say that the preference is unverified. |
| **Explore** | A research instruction, such as “surface unusual customer-facing AI roles.” | Broaden LLM discovery without pretending it is a filter. |

Blank controls mean “no preference.” Unknown public facts are labelled **unknown**, not silently treated as a match or a rejection. This avoids accidentally excluding interesting early-stage companies that have incomplete public data.

### What a user can control

The profile editor should be a concise guided form with an optional freeform brief—not a raw prompt editor:

1. **Role and work**: existing role families, custom target titles/phrases, seniority or experience ceiling, customer-facing versus product/internal preference, desired functions, locations, remote/hybrid policy, and titles/keywords to avoid.
2. **Company shape**: preferred or required stage (pre-seed through public), team-size bands, sectors/themes, business model tags (for example enterprise, developer tools, applied AI), and companies to avoid. Existing follows remain the way to name specific companies to track closely.
3. **Economics and risk**: equity importance (not a factor, nice to have, important, must be discussed), compensation note, and optional value/risk exclusions. Equity is a discovery/ranking cue only unless a role posting or a cited source expressly supports it.
4. **What should trigger attention**: select updates such as funding, customer traction, hiring growth, product launches, leadership/team changes, and new role openings.
5. **Freeform search brief**: a bounded plain-language “what I am optimizing for” field. It supplements structured controls; it never replaces them or becomes an unreviewed instruction channel.

The UI should show a plain-English **Search brief preview** and a compact active-filters summary. Each value says whether it affects discovery, ranking, role inclusion, or all three.

### Preserve two different scores

- **Growth Score** stays as today: evidence, funding momentum, hiring, traction, and product signals. It remains comparable across companies and must not change merely because a user prefers an earlier-stage employer.
- **Fit to your search** is a new, explainable relevance score/label calculated from the user profile. Its component reasons might read: “matches custom role phrase,” “preferred Series A–B,” “team size unknown,” or “outside required location.”

The digest and dashboard can sort by fit where the user is deciding what to pursue, while preserving Growth Score and evidence in the presentation. Discovery never promotes an unsupported LLM claim directly to either score.

## Tasks

### Profile schema and compatibility

- [x] Define additive SearchProfile fields and safe defaults for custom role phrases, company-stage and team-size preferences, economics/equity priority, business-model themes, avoid lists, signal interests, and the bounded freeform brief. — **SlopReviewer:** extend the existing `SearchProfile` interface (`src/types.ts`) AND add every new field's default to `defaultSearchProfile()` (`src/db/db.ts`), or old singleton rows won't backfill and the backward-compat criterion fails silently. Persist via the existing `search_profile` JSON singleton — no new table/columns.
- [x] Model every new preference as required, preferred, or explore where that distinction is meaningful; retain the current location/remote behavior as a hard role constraint.
- [x] Keep the singleton JSON row backward-compatible: existing profile records load with defaults, and saving a new profile never loses legacy role, location, sector, exclusion, or score-threshold fields.
- [x] Validate and normalize user input at the API boundary: trimmed/deduplicated strings, explicit enums, length/count limits, and canonicalized domains for avoid lists. Store only local profile data in SQLite. — **SlopReviewer:** extend the existing `sanitizeProfile()` in `src/server.ts` (already does enum-whitelist + count-cap + numeric-clamp; add trim/dedupe there) — do NOT add a parallel validator. Canonicalize avoid-list domains with `companyKey`/`normalizeDomain` from `src/lib/identity.ts` (do not write a new normalizer; `server.ts` already uses `companyKey` for domain inputs).

### Evidence-backed personal relevance

- [x] Define a compact CompanyFitFacts representation for only the facts the system can support: verified funding stage, sourced employee-size band when available, sector/business-model tags, role/equity language from a live posting, and explicit unknown states. — **SlopReviewer:** derive funding-stage facts from the existing `FundingEvent.stage` / `parseStage` (`src/lib/fundingLanguage.ts`) — do not re-parse claim text. Reuse the existing `FundingStage: "unknown"` convention for unknowns. Employee-size band is genuinely new (no existing parser); do not infer it from role count or funding amount.
- [x] Implement a deterministic relevance evaluator that yields an inclusion decision, a rank/label, and concise per-criterion reasons. Required failures exclude from the primary queue; preferred misses and unknowns remain visible with explanation. — **SlopReviewer:** put it in a NEW `src/lib/relevance.ts` that reads `GrowthScore` (`src/lib/scoring.ts`), `SearchProfile`, and `CompanyFitFacts` read-only. There is no existing fit/relevance computation to duplicate — but do NOT add fit weighting into `scoreCompany`/`config.scoreWeights`. Keep it a small deterministic function; resist a rules-engine layer.
- [x] Extend role matching to support custom title phrases safely, using normalized title matching rather than broad job-description keyword matching that would create false positives. — **SlopReviewer (P1):** extend the TITLE path of `matchJob()` in `src/lib/roleMatch.ts` and match custom phrases against `job.title` ONLY. The stale header comment (`roleMatch.ts:2`, "title AND JD body AND team") and the `RoleMatch.matchedOn: ("title"|"body"|"team")[]` union (`src/types.ts`) are leftover scaffolding from BEFORE JD-body matching was deliberately removed for false positives (E3, see `config.ts:44-47`). Do NOT reintroduce body/JD-keyword matching; clean up the stale comment and narrow `matchedOn` to `"title"` while you're there.
- [x] Apply personal relevance after evidence validation and independently from the Growth Score. Do not modify score weights, funding classification, or confidence semantics in this sprint.

### LLM discovery alignment

- [x] Build the discovery instruction from the normalized profile, with an explicit section for hard constraints, preferences, exploratory themes, and a safe bounded freeform brief. — **SlopReviewer:** modify the single existing prompt builder in `src/discover.ts` (`SYSTEM` constant + `userPrompt()`) — do not add a second discovery path. Preserve its closed-round/rumor, canonical-domain ("never guess a domain"), and dated-source rules, and keep the deterministic gates in `src/ingest.ts` (`companyKey`, `classifyFundingClaim`, review queue) fully intact.
- [x] Ask the LLM to return structured fit facts and source URLs for any claimed stage, size, sector, or equity signal; retain the existing closed-round, canonical-domain, and dated-source rules.
- [x] Treat LLM fit facts as candidate evidence for deterministic validation—not as authority to override missing/contradictory facts. Preserve the review queue for unresolved domains and unsupported claims.
- [x] Ensure an empty/default profile continues to produce the current broad AI-industry discovery behavior, so an unfinished profile does not silently narrow the user’s results.

### Dashboard and daily loop

- [x] Evolve **Preferences** into a clear **Search criteria** experience with guided optional controls, required/preferred/explore choices, inline examples, and a reset to broad defaults.
- [x] Provide a read-only preview of the normalized research brief and indicate which information will be sent to the LLM during scan discover.
- [x] Show “Why this fits” and “unknown / not verified” reasons on role and company surfaces without obscuring the existing Growth Score, evidence, or fit caveats.
- [x] Sort the roles queue and relevant digest section by inclusion then personal fit, while preserving a separate industry-wide/funding view so exploratory signals are not lost.
- [x] Make profile changes affect the next scan discover and role evaluation; re-evaluate cached current ATS jobs locally where possible, without rewriting past digest history or running a scan as a side effect of saving.

### Tests, documentation, and local constraints

- [x] Add unit tests for defaults/migration, normalization, required versus preferred behavior, unknown facts, custom-title precision, relevance explanations, and dynamic discovery-instruction construction.
- [x] Add server tests for round-trip profile persistence and validation failures, plus digest/role-order tests proving Growth Score remains independent from personal fit.
- [x] Update README.md, src/README.md, and the local in-product explanation with the two-score model, what gets sent to the LLM, and the limits of stage/size/equity data.
- [x] Keep the tool local-only; add no cloud services, accounts, paid data source, or new infrastructure for this sprint.

## Browser Testing & Validation (agent-browser CLI)

> **MANDATORY**: Do not mark web tasks complete without browser validation against the local server and inspection of matching SQLite state.

- [x] Start the local UI with bun run scan serve and open http://127.0.0.1:3000/#preferences; capture the initial screenshot and agent-browser snapshot -i.
- [x] Enter a realistic mixed profile: custom role phrase, required location/remote constraint, preferred early-stage/small-team/equity criteria, a sector theme, and a short freeform brief. Save and reload; confirm the state through the profile API and state/ajr.db.
- [x] Verify invalid enum values, oversized text, malformed avoid domains, and an empty profile have visible, understandable error/default states without losing valid work.
- [x] Inspect the generated research-brief preview and verify it distinguishes required, preferred, and exploratory instructions without exposing secrets.
- [x] Verify a cached role/company view shows Growth Score, fit reasons, and unknown facts separately; test a required mismatch and a preferred-but-unknown company.
- [x] Take final desktop and narrow-window screenshots, inspect browser console errors, and document all results/failures in this sprint file.

## Acceptance Criteria

- [x] A user can describe both broad/open-ended and tightly constrained job searches without having to write an LLM prompt.
- [x] A saved profile changes subsequent discovery instructions, role relevance, and ordering in a traceable way while default behavior remains broad.
- [x] Required constraints, preferences, exploratory interests, and unknown facts are visibly distinct to the user.
- [x] Growth Score/evidence quality remain objective and separate from personal fit.
- [x] Profile persistence, deterministic relevance, LLM instruction construction, and browser flows pass automated and manual validation.

## Notes for Future Developers

- The search-profile row is already a JSON blob; use additive defaults rather than a premature relational schema. If preferences become queryable/auditable at scale, that can be reconsidered later.
- Company size and equity are often unavailable publicly. “Unknown” is a useful outcome; do not infer equity from funding amount or company size from role count.
- The freeform brief must be bounded and represented as data in the LLM prompt. It must not weaken evidence, funding-language, source, identity, or review safeguards.
- Pinned companies express ongoing research intent; do not create a second competing target-company list in this sprint.
- The title-first role-matching guardrail (and the reason JD-body matching was removed) is documented at `src/config.ts:44-47` and `src/lib/roleMatch.ts:14-21`. Read it before touching `matchJob`.

### Validation evidence — 2026-08-14

- `bun run typecheck` and `bun test` passed: 68 tests across 15 files.
- Local browser QA used `agent-browser` at `http://127.0.0.1:3000`: desktop and 390px screenshots captured at `/tmp/ajr-s5-final.png` and `/tmp/ajr-s5-mobile.png`; console/errors were clean.
- A mixed profile saved, reloaded, produced the exact preview from `/api/profile/brief`, and was confirmed in `state/ajr.db`. The profile was reset to broad defaults after QA.
- Invalid stage values and >500-character briefs return HTTP 400 in server tests; a malformed company domain surfaced `Use a valid search profile.` in browser QA and left the persisted profile unchanged.
- Location selection uses the on-device, MIT-licensed Countries States Cities dataset rather than a finite hand-maintained list. Browser QA confirmed canonical city chips persist, raw values are rejected, and `London, UK` disambiguates to London, England, United Kingdom.

## Slop Findings (SlopReviewer — 2026-08-14)

**Verdict: Clean plan, minor adjustments.** Every foundational claim verified against real code: the singleton `search_profile` JSON row + `/api/profile` route, the `SearchProfile` type, the identity/funding libs, title-based matching, and an untouched Growth Score all exist. No P0. One P1 regression trap; the rest are duplication-avoidance nudges. **Not blocking** — proceed after adopting the P1 fix.

### P1
- [x] **[3 Hallucination-risk / 11 Migration debris — JD-body matching trap]** Task "Extend role matching…". The deliberately-removed JD-body matcher still has live scaffolding: the `roleMatch.ts:2` header comment ("title AND JD body AND team") and the `RoleMatch.matchedOn: ("title"|"body"|"team")[]` union (`types.ts`). Adding "custom title phrases" tempts an implementer to match against the JD body and reintroduce the removed false-positive pattern (E3). **Fix:** match custom phrases against `job.title` only; extend `matchJob()`'s title path; delete the stale comment and narrow `matchedOn` to `"title"`. (Inline-annotated in the task above.)

### P2
- [x] **[1 Duplication — domain canonicalization]** "…canonicalized domains for avoid lists". **Fix:** reuse `companyKey`/`normalizeDomain` (`src/lib/identity.ts`); do not write a new normalizer.
- [x] **[1 Duplication — input validation]** "Validate and normalize user input…". **Fix:** extend the existing `sanitizeProfile()` (`src/server.ts`); do not add a parallel validator lib.
- [x] **[1 Duplication / 12 Drift — funding-stage facts]** "CompanyFitFacts… verified funding stage". **Fix:** derive from `FundingEvent.stage` / `parseStage` (`src/lib/fundingLanguage.ts`); do not re-parse claim text.
- [x] **[15 Schema/migration — profile backfill]** "Define additive SearchProfile fields…". New JSON fields must also be added to `defaultSearchProfile()` (`src/db/db.ts`) or old singleton rows won't backfill and the "records load with defaults" criterion silently fails.

### P3
- [x] **[6 Comment pollution / 11 Dead code]** The stale `roleMatch.ts` header comment and the `matchedOn` `"body"|"team"` union are misleading debris — clean up when touching role matching (bundled with the P1 fix).
- [x] **[4 Over-engineering — watch]** Keep the relevance evaluator a small deterministic function in `src/lib/relevance.ts`; resist a rules-engine / config-knob layer nothing sets.

### Slop Avoided (positive)
- Keeps `scoring.ts` / `config.scoreWeights` untouched; "Fit to your search" is explicitly separate from Growth Score — no re-derivation of the canonical score.
- Preserves the two-layer safeguard design: LLM prompt rules in `discover.ts` PLUS the deterministic gates in `ingest.ts` (`companyKey`, `classifyFundingClaim`, review queue).
- Uses the existing `search_profile` JSON singleton with additive defaults — genuinely backward-compatible, no risky relational migration (matches the established `ensureColumn` additive pattern in `db.ts`).
- Title-first matching stance aligns with the E3 guardrail (`config.ts:44-47`); the freeform brief is bounded as data, not an unreviewed instruction channel.
- "Unknown" facts mirror the existing `FundingStage: "unknown"` convention; refuses to infer size/equity from funding — consistent with the project's evidence-gate ethos.

### Centralized systems checked
`src/lib/identity.ts` (domain), `src/lib/fundingLanguage.ts` (funding), `src/lib/roleMatch.ts` + `src/config.ts` (matching + role forms/excludes), `src/lib/scoring.ts` (Growth Score), `src/discover.ts` + `src/ingest.ts` (discovery prompt + deterministic gates), `src/server.ts` `sanitizeProfile` (validation), `src/db/db.ts` (`search_profile` singleton + `ensureColumn` migrations). No `.claude/rules/`, no CI guards, no linter — nothing to bypass. No audit ledger — regression check done against code + the E3 history in comments/config.
