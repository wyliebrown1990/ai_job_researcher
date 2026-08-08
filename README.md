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

## Design

The full loop design (goal, node graph, verification, evals, budgets, human-approval
gates) lives in **[docs/AGENT_LOOP_DESIGN.md](docs/AGENT_LOOP_DESIGN.md)**.

## Status

🚧 Early build. Design approved; validating the core ENRICH → JOB SCAN → VERIFY
slice (the funding + hiring-velocity ingestion bottleneck) before automating the
full daily schedule.

## Stack

- **TypeScript + bun** deterministic fetchers (job-board APIs, GitHub, RSS/news)
- **Claude Code** agent run for discovery, scoring, and digest synthesis
- **Free/public data sources** (WebSearch/WebFetch, Greenhouse/Lever/Ashby, GitHub)
- State in a committed SQLite/JSON store · daily digest delivered by email
