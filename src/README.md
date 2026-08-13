# src — build scaffold

TypeScript + bun implementation of the research loop. See
[../docs/AGENT_LOOP_DESIGN.md](../docs/AGENT_LOOP_DESIGN.md) for the node graph.

## Layout

```
src/
  config.ts            # budgets, staleness, target roles + exclusions, score weights
  types.ts             # Company, JobPosting, FundingEvent, GrowthScore, ReviewItem, …
  pipeline.ts          # daily loop: ingest→refresh→job-scan→verify→rank→deliver
  discover.ts          # DISCOVER (N3) — Claude + web search → Candidate[] (LLM edge)
  ingest.ts            # pure boundary: Candidate[] → watchlist/review (dedup, rumor gate)
  digest.ts            # RANK & DIGEST — renders the daily markdown (N9)
  deliver.ts           # PERSIST & DELIVER — writes digests/ + emails via Resend (N10)
  mailer.ts            # Resend send (this project's own key; graceful no-op if unset)
  seed.ts              # bootstrap watchlist + review items from data/seed.json
  db/db.ts             # bun:sqlite state store (idempotency, review queue)
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
    enrich.ts          # ENRICH & SCORE + JOB SCAN for one company (N5/N6)
  cli.ts               # entry: run / seed / jobs / detect / review / list
```

## The daily run

`bun run scan run` executes the full deterministic loop over the watchlist:
ingest state → refresh each company's ATS board (open-roles + hiring-velocity delta +
role matches) → score & bucket → verify the evidence gate → render
`digests/digest-YYYY-MM-DD.md` → persist. Runs are idempotent per calendar day
(`--force` to re-run). Email delivery is the remaining last-mile TODO in `deliver.ts`.

**State & audit trail:** the human-readable record is `data/seed.json` + the committed
`digests/`. The SQLite store under `state/` is a rebuildable local cache (gitignored).

## Email + schedule

Delivery uses **Resend** with **this project's own** API key (never another
project's). Copy `.env.example` → `.env`, set `RESEND_API_KEY` + `AJR_EMAIL_FROM`
(a Resend-verified sender); recipient defaults to `wyliebrown1990@gmail.com`. Without
a key, runs still produce the digest file and skip email gracefully. The daily
schedule (macOS launchd, 7:00 AM) lives in [`deploy/`](../deploy/README.md).

## What is deterministic vs LLM

**Deterministic (implemented, unit-tested):** ATS fetching, domain dedup, funding-
language classification, title-first role matching, growth scoring + bucketing,
SQLite persistence + run idempotency. These are the parts we can verify reliably.

**LLM edge (implemented, key-gated):** DISCOVER (`discover.ts`) — Claude with the
server-side web-search tool surfaces fresh candidates; the **pure** `ingest.ts`
boundary applies the deterministic rules before anything reaches the watchlist.

**Still deferred to the LLM:** semantic body-level role fit and richer
traction/product-momentum scoring (design §"kept manual").

## Run

```bash
bun install
bun test            # 33 unit tests across identity/funding/roleMatch/scoring/digest/ingest
bun run typecheck   # tsc --noEmit, strict
bun run scan seed                            # bootstrap watchlist from data/seed.json
bun run scan discover                        # LLM finds fresh companies (needs ANTHROPIC_API_KEY)
bun run scan run                             # run the full daily loop → digests/
bun run scan run --discover                  # discover fresh companies, then run
bun run scan run --force                     # re-run same day (idempotency override)
bun run scan serve                           # local dashboard at http://127.0.0.1:3000
bun run scan jobs happyrobot.ai              # live JOB SCAN one board (auto-detect ATS)
bun run scan jobs anthropic --provider greenhouse
bun run scan detect <slug>                   # which ATS a slug uses
bun run scan list                            # watchlist
bun run scan review                          # review queue
```

## Config knobs

All tunable behavior — budgets, staleness windows, score weights, bucket thresholds,
target-role forms, and the title exclusion list — lives in `config.ts`.

The dashboard persists personal filters in SQLite's `search_profile` record, which
overrides these defaults for subsequent scans. Back up `state/ajr.db` before resetting
local state or moving machines.
