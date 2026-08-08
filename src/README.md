# src — build scaffold

TypeScript + bun implementation of the research loop. See
[../docs/AGENT_LOOP_DESIGN.md](../docs/AGENT_LOOP_DESIGN.md) for the node graph.

## Layout

```
src/
  config.ts            # budgets, staleness, target roles + exclusions, score weights
  types.ts             # Company, JobPosting, FundingEvent, GrowthScore, ReviewItem, …
  db/db.ts             # bun:sqlite state store (watchlist audit trail, idempotency)
  fetchers/
    http.ts            # fetch w/ per-run budget + timeout (design §6)
    ats/ashby.ts       # Ashby posting API (validated, E1)
    ats/greenhouse.ts  # Greenhouse board API (validated, E3)
    ats/lever.ts       # Lever postings API
    ats/index.ts       # unified fetchBoard() + detectBoard()
  lib/
    identity.ts        # domain-based dedup + aliases (E4)
    fundingLanguage.ts # rumor≠round classifier + amount/stage parse (E5)
    roleMatch.ts       # title-first role matching + fit_caveat (E1/E3)
    scoring.ts         # growth score + buckets (funding≠growth, E2)
  cli.ts               # entry: jobs / detect / review / list
```

## What is deterministic vs LLM

**Deterministic (implemented, unit-tested):** ATS fetching, domain dedup, funding-
language classification, title-first role matching, growth scoring + bucketing,
SQLite persistence + run idempotency. These are the parts we can verify reliably.

**Deferred to the LLM enrichment node (interfaces only for now):** DISCOVER breadth
(surfacing candidates from funding news), semantic body-level role fit, customer-
traction and product-momentum sub-scores, and digest prose. Kept manual/LLM because
they can't yet be verified deterministically (design §"kept manual").

## Run

```bash
bun install
bun test            # 22 unit tests across identity/funding/roleMatch/scoring
bun run typecheck   # tsc --noEmit, strict
bun run scan jobs happyrobot.ai              # live JOB SCAN (auto-detect ATS)
bun run scan jobs anthropic --provider greenhouse
bun run scan detect <slug>                   # which ATS a slug uses
bun run scan list                            # watchlist
bun run scan review                          # review queue
```

## Config knobs

All tunable behavior — budgets, staleness windows, score weights, bucket thresholds,
target-role forms, and the title exclusion list — lives in `config.ts`.
