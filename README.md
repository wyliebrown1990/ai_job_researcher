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

🚧 Early build. Design approved and validated against live data (5/5 eval cases pass).
The deterministic core is implemented and unit-tested — ATS fetchers (Ashby /
Greenhouse / Lever), domain-based dedup, funding-language classifier, title-first
role matching, growth scoring + bucketing, and a SQLite state store. The full daily
loop runs (`bun run scan run`), renders a digest, and **emails it via Resend** (this
project's own key) to wyliebrown1990@gmail.com on a **7:00 AM launchd schedule** (see
[deploy/](deploy/README.md)). Next: wire the LLM discovery/enrichment node so the
watchlist grows itself. See [src/README.md](src/README.md).

## Stack

- **TypeScript + bun** deterministic fetchers (job-board APIs, GitHub, RSS/news)
- **Claude Code** agent run for discovery, scoring, and digest synthesis
- **Free/public data sources** (WebSearch/WebFetch, Greenhouse/Lever/Ashby, GitHub)
- State in a committed SQLite/JSON store · daily digest delivered by email
