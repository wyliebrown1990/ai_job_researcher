# ai_job_researcher

An automated daily agent loop that researches the AI industry to identify companies
experiencing **real, quantifiable growth** — and surfaces the ones worth following
and the roles worth considering.

Each morning the loop:

1. **Discovers** newly founded / newly funded AI companies.
2. **Refreshes** growth signals on companies already tracked.
3. **Scans** for open roles matching a technical-GTM skill set (Sales Engineer,
   Solutions Engineer, Product Manager, Partner/Partnerships).
4. **Scores** each company on quantifiable growth — not hype (every claim needs a
   dated source).
5. **Emails** a curated digest that's a delta on the day before: industry pulse,
   new entrants, top movers, funding in the last 24–48h, and roles for you.

## Local dashboard

Run `bun run scan serve` and open `http://127.0.0.1:3000` for the local-only AI
Career Intelligence Console. Tune the search profile, inspect company evidence,
save/hide individual roles, keep a lightweight opportunity pipeline, read past
digests, and resolve the review queue. Personal state is in `state/ajr.db`; back it
up before a machine migration or reset.

## Design

The full loop design (goal, node graph, verification, evals, budgets, human-approval
gates) lives in **[docs/AGENT_LOOP_DESIGN.md](docs/AGENT_LOOP_DESIGN.md)**.

## Status

🚧 Early build. Design approved and validated against live data (5/5 eval cases pass).
The full loop is wired end to end. The deterministic core — ATS fetchers (Ashby /
Greenhouse / Lever), domain-based dedup, funding-language classifier, title-first
role matching, growth scoring + bucketing, SQLite state — is implemented and
unit-tested (33 tests). The **LLM DISCOVER node** (`scan discover`) uses Claude with
web search to surface fresh companies, feeding a **pure ingest boundary** that applies
the dedup/rumor/evidence rules before anything reaches the watchlist. The daily run
(`scan run --discover`) discovers, refreshes, scores, renders a digest, and **emails
it via Resend** (this project's own key) to wyliebrown1990@gmail.com on a **7:00 AM
launchd schedule** (see [deploy/](deploy/README.md)). Use `scan run --no-email` for a
safe local refresh that persists the digest but intentionally skips delivery. See
[src/README.md](src/README.md).

## Stack

- **TypeScript + bun** deterministic fetchers (job-board APIs, GitHub, RSS/news)
- **Claude Code** agent run for discovery, scoring, and digest synthesis
- **Free/public data sources** (WebSearch/WebFetch, Greenhouse/Lever/Ashby, GitHub)
- State in a committed SQLite/JSON store · daily digest delivered by email
