# Project Profile — ai_job_researcher

> Created 2026-08-08 during `/DevPlanning`. This project had no profile; this file
> captures the facts so planning/validation reflect the real (local) stack.

## What it is
An automated daily agent loop that researches the AI industry, scores companies on
quantifiable growth, tracks target-role job openings, and emails a digest. **It runs
locally on the user's Mac — there is no cloud deployment.**

## Stack facts (the `profile.<field>` values this repo's plans reference)

| Field | Value |
|-------|-------|
| `runtime` | Bun + TypeScript (ESM). Runs on macOS. NEVER npm/yarn/pnpm — bun only. |
| `datastore` | SQLite via `bun:sqlite` at `state/ajr.db` — **a rebuildable local cache** (gitignored). |
| `source_of_truth` | Design: `docs/AGENT_LOOP_DESIGN.md`. Human-readable audit trail: `data/seed.json` + committed `digests/`. Live state: `state/ajr.db` (rebuildable from seed + runs). |
| `runtime_config_file` | `.env` (this project's OWN `RESEND_API_KEY`, `ANTHROPIC_API_KEY`, email vars) + `src/config.ts` (tunables). |
| `deploy` / `deploy_production` | **No cloud deploy.** "Ship" = commit to `main` (github.com/wyliebrown1990/ai_job_researcher) + the local install runs it. Scheduled via macOS **launchd** (`deploy/com.ajr.daily.plist`, 7 AM). |
| `prod_url` | **No public URL.** The dashboard (this roadmap) runs at `http://127.0.0.1:3000`. |
| `web_validation_tool` | The **`/Browser` skill** (agent-browser CLI). **NEVER `mcp__claude-in-chrome__*`** (global guardrail). |
| `backend_read_cmd` | SQLite read against `state/ajr.db` — e.g. `bun -e 'import {Database} from "bun:sqlite"; console.log(new Database("state/ajr.db").query("SELECT ...").all())'`; plus `bun run scan list` / `scan review`. |
| `test` | `bun test` |
| `typecheck` | `bun run typecheck` (`tsc --noEmit`, strict) |
| `lint` | None configured. |
| `service_topology` | Single local process. CLI (`bun run scan …`) + daily launchd job + (this roadmap) a local dashboard server. No microservices, no queues. |
| `source_layout` | `src/` (`fetchers/`, `lib/`, `db/`, plus node modules: `discover.ts`, `ingest.ts`, `pipeline.ts`, `digest.ts`, `deliver.ts`, `mailer.ts`, `seed.ts`, `cli.ts`), `tests/`, `docs/`, `roadmap/`, `data/seed.json`, `digests/`, `deploy/`, `scripts/`. |
| `guardrails` | bun only. TypeScript preferred. Each project uses its **OWN** resources/secrets (never amicai/getamicai's). All email → `wyliebrown1990@gmail.com`. Web validation via `/Browser` (agent-browser), never claude-in-chrome. |

## Validation adaptation (IMPORTANT — no cloud prod)
The DevPlanning "deploy to prod + validate on a live URL" discipline maps to this
local stack as: the two-halves round-trip is **(1)** the dashboard rendering at
`http://127.0.0.1:3000` (verified with `/Browser`) and **(2)** the mutation confirmed
by reading `state/ajr.db` with `backend_read_cmd` — never inferred from the UI.
"Deploy to prod" = the change is committed to `main` and runs on the local install.
