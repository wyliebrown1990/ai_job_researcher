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

- [ ] Define additive SearchProfile fields and safe defaults for custom role phrases, company-stage and team-size preferences, economics/equity priority, business-model themes, avoid lists, signal interests, and the bounded freeform brief.
- [ ] Model every new preference as required, preferred, or explore where that distinction is meaningful; retain the current location/remote behavior as a hard role constraint.
- [ ] Keep the singleton JSON row backward-compatible: existing profile records load with defaults, and saving a new profile never loses legacy role, location, sector, exclusion, or score-threshold fields.
- [ ] Validate and normalize user input at the API boundary: trimmed/deduplicated strings, explicit enums, length/count limits, and canonicalized domains for avoid lists. Store only local profile data in SQLite.

### Evidence-backed personal relevance

- [ ] Define a compact CompanyFitFacts representation for only the facts the system can support: verified funding stage, sourced employee-size band when available, sector/business-model tags, role/equity language from a live posting, and explicit unknown states.
- [ ] Implement a deterministic relevance evaluator that yields an inclusion decision, a rank/label, and concise per-criterion reasons. Required failures exclude from the primary queue; preferred misses and unknowns remain visible with explanation.
- [ ] Extend role matching to support custom title phrases safely, using normalized title matching rather than broad job-description keyword matching that would create false positives.
- [ ] Apply personal relevance after evidence validation and independently from the Growth Score. Do not modify score weights, funding classification, or confidence semantics in this sprint.

### LLM discovery alignment

- [ ] Build the discovery instruction from the normalized profile, with an explicit section for hard constraints, preferences, exploratory themes, and a safe bounded freeform brief.
- [ ] Ask the LLM to return structured fit facts and source URLs for any claimed stage, size, sector, or equity signal; retain the existing closed-round, canonical-domain, and dated-source rules.
- [ ] Treat LLM fit facts as candidate evidence for deterministic validation—not as authority to override missing/contradictory facts. Preserve the review queue for unresolved domains and unsupported claims.
- [ ] Ensure an empty/default profile continues to produce the current broad AI-industry discovery behavior, so an unfinished profile does not silently narrow the user’s results.

### Dashboard and daily loop

- [ ] Evolve **Preferences** into a clear **Search criteria** experience with guided optional controls, required/preferred/explore choices, inline examples, and a reset to broad defaults.
- [ ] Provide a read-only preview of the normalized research brief and indicate which information will be sent to the LLM during scan discover.
- [ ] Show “Why this fits” and “unknown / not verified” reasons on role and company surfaces without obscuring the existing Growth Score, evidence, or fit caveats.
- [ ] Sort the roles queue and relevant digest section by inclusion then personal fit, while preserving a separate industry-wide/funding view so exploratory signals are not lost.
- [ ] Make profile changes affect the next scan discover and role evaluation; re-evaluate cached current ATS jobs locally where possible, without rewriting past digest history or running a scan as a side effect of saving.

### Tests, documentation, and local constraints

- [ ] Add unit tests for defaults/migration, normalization, required versus preferred behavior, unknown facts, custom-title precision, relevance explanations, and dynamic discovery-instruction construction.
- [ ] Add server tests for round-trip profile persistence and validation failures, plus digest/role-order tests proving Growth Score remains independent from personal fit.
- [ ] Update README.md, src/README.md, and the local in-product explanation with the two-score model, what gets sent to the LLM, and the limits of stage/size/equity data.
- [ ] Keep the tool local-only; add no cloud services, accounts, paid data source, or new infrastructure for this sprint.

## Browser Testing & Validation (agent-browser CLI)

> **MANDATORY**: Do not mark web tasks complete without browser validation against the local server and inspection of matching SQLite state.

- [ ] Start the local UI with bun run scan serve and open http://127.0.0.1:3000/#preferences; capture the initial screenshot and agent-browser snapshot -i.
- [ ] Enter a realistic mixed profile: custom role phrase, required location/remote constraint, preferred early-stage/small-team/equity criteria, a sector theme, and a short freeform brief. Save and reload; confirm the state through the profile API and state/ajr.db.
- [ ] Verify invalid enum values, oversized text, malformed avoid domains, and an empty profile have visible, understandable error/default states without losing valid work.
- [ ] Inspect the generated research-brief preview and verify it distinguishes required, preferred, and exploratory instructions without exposing secrets.
- [ ] Verify a cached role/company view shows Growth Score, fit reasons, and unknown facts separately; test a required mismatch and a preferred-but-unknown company.
- [ ] Take final desktop and narrow-window screenshots, inspect browser console errors, and document all results/failures in this sprint file.

## Acceptance Criteria

- [ ] A user can describe both broad/open-ended and tightly constrained job searches without having to write an LLM prompt.
- [ ] A saved profile changes subsequent discovery instructions, role relevance, and ordering in a traceable way while default behavior remains broad.
- [ ] Required constraints, preferences, exploratory interests, and unknown facts are visibly distinct to the user.
- [ ] Growth Score/evidence quality remain objective and separate from personal fit.
- [ ] Profile persistence, deterministic relevance, LLM instruction construction, and browser flows pass automated and manual validation.

## Notes for Future Developers

- The search-profile row is already a JSON blob; use additive defaults rather than a premature relational schema. If preferences become queryable/auditable at scale, that can be reconsidered later.
- Company size and equity are often unavailable publicly. “Unknown” is a useful outcome; do not infer equity from funding amount or company size from role count.
- The freeform brief must be bounded and represented as data in the LLM prompt. It must not weaken evidence, funding-language, source, identity, or review safeguards.
- Pinned companies express ongoing research intent; do not create a second competing target-company list in this sprint.
