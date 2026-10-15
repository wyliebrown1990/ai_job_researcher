// CLI entry for the research loop.
//   bun run scan jobs <slug> [--provider ashby|greenhouse|lever]  # JOB SCAN a board
//   bun run scan detect <slug>                                    # auto-detect ATS
//   bun run scan review                                           # show review queue
//   bun run scan list                                             # show watchlist
//   bun run scan resolve                                          # retry unresolved domains + missing job boards
//
// The full daily loop (ingest→…→deliver) is orchestrated separately; these commands
// exercise the deterministic nodes against live data.

import type { AtsProvider } from "./types.ts";
import { fetchBoard, detectBoard } from "./fetchers/ats/index.ts";
import { liveResolveDeps, resolveCandidates, resolveCareersFor, runMaintenance } from "./resolve/index.ts";
import type { Candidate } from "./types.ts";
import { matchBoard } from "./lib/roleMatch.ts";
import { fetchesUsed } from "./fetchers/http.ts";
import { Store } from "./db/db.ts";
import { runDaily } from "./pipeline.ts";
import { loadSeed } from "./seed.ts";
import { discoverCandidates, discoveryConfigured } from "./discover.ts";
import { ingestCandidates } from "./ingest.ts";
import { startServer } from "./server.ts";
import { parseFlags } from "./lib/cliFlags.ts";

async function cmdJobs(slug: string, provider?: AtsProvider) {
  const result = provider
    ? { ref: { provider, slug }, jobs: await fetchBoard({ provider, slug }) }
    : await detectBoard(slug);
  if (!result || result.jobs.length === 0) {
    console.log(`No board found for "${slug}". Try --provider and check the slug.`);
    return;
  }
  const { ref, jobs } = result;
  const matches = matchBoard(jobs);
  console.log(`\n📋 ${slug}  [${ref.provider}]  —  ${jobs.length} open roles, ${matches.length} match your target titles\n`);
  if (matches.length === 0) {
    console.log("  (no NYC/remote technical pre-sales roles open right now)");
  }
  for (const m of matches) {
    const pct = Math.round(m.matchScore * 100);
    console.log(`  • ${m.job.title}  —  ${m.customTitlePhrase ?? m.role} (${pct}% match, via ${m.matchedOn.join("+")})`);
    console.log(`    ${m.job.location}${m.job.publishedDate ? ` · posted ${m.job.publishedDate}` : ""}`);
    if (m.fitCaveat) console.log(`    ⚠ ${m.fitCaveat}`);
    console.log(`    ${m.job.url}`);
  }
  console.log(`\n(${fetchesUsed()} fetch(es) used)\n`);
}

async function cmdDetect(slug: string) {
  const r = await detectBoard(slug);
  if (!r) { console.log(`No ATS board found for "${slug}".`); return; }
  console.log(`${slug} → ${r.ref.provider} (${r.jobs.length} postings)`);
}

function cmdReview() {
  const store = new Store();
  const items = store.openReviewItems();
  console.log(`\n📥 Review queue — ${items.length} item(s)\n`);
  for (const it of items) console.log(`  • [${it.reason}] ${it.displayName} — ${it.detail}`);
  store.close();
}

function cmdList() {
  const store = new Store();
  const cos = store.allCompanies();
  console.log(`\n👁  Watchlist — ${cos.length} companies\n`);
  for (const c of cos) {
    console.log(`  • ${c.displayName} [${c.domain}] score=${c.score?.score ?? "—"} bucket=${c.score?.bucket ?? "—"}`);
  }
  store.close();
}

function cmdSeed(path?: string) {
  const store = new Store();
  const { companies, review } = loadSeed(store, path ?? "data/seed.json");
  console.log(`Seeded ${companies} company(ies) and ${review} review item(s).`);
  store.close();
}

/** Stages 2-3 then ingest then stage 2b: domains verified before ingest, boards after. */
async function resolveAndIngest(store: Store, candidates: Candidate[]) {
  const deps = liveResolveDeps();
  const r = await resolveCandidates(store, candidates, deps);
  const summary = ingestCandidates(store, candidates);
  const boards = await resolveCareersFor(store, summary.newDomains, deps);
  console.log(`   domains: ${r.verified} confirmed, ${r.resolved} resolved, ${r.unresolved} to review · ${boards}/${summary.newDomains.length} new job board(s) found`);
  return summary;
}

async function maintain(store: Store) {
  const m = await runMaintenance(store, liveResolveDeps());
  console.log(`🩺 Maintenance: ${m.backlogResolved}/${m.backlogTried} review item(s) resolved · ${m.atsFound}/${m.atsChecked} job board(s) found`);
}

async function cmdResolve() {
  const store = new Store();
  try {
    await maintain(store);
  } finally {
    store.close();
  }
}

async function cmdDiscover() {
  if (!discoveryConfigured()) {
    console.log("Discovery needs ANTHROPIC_API_KEY (this project's own key) — see .env.example.");
    return;
  }
  const store = new Store();
  console.log("🔎 Discovering fresh AI companies via web search…");
  try {
    const candidates = await discoverCandidates(store.getSearchProfile());
    const summary = await resolveAndIngest(store, candidates);
    console.log(`Ingested ${candidates.length} candidate(s): +${summary.added} new, ${summary.refreshed} refreshed, ${summary.reviewed} to review.`);
  } catch (e) {
    console.log(`⚠ discovery failed: ${(e as Error).message}`);
  } finally {
    store.close();
  }
}

async function cmdRun(force: boolean, discover: boolean, skipEmail: boolean) {
  const store = new Store();
  if (discover && discoveryConfigured()) {
    console.log("🔎 Discovering fresh companies first…");
    const candidates = await discoverCandidates(store.getSearchProfile()).catch((e) => { console.log(`   ⚠ discovery skipped: ${e.message}`); return []; });
    if (candidates.length) {
      const s = await resolveAndIngest(store, candidates);
      console.log(`   +${s.added} new, ${s.refreshed} refreshed, ${s.reviewed} to review`);
    }
  }
  await maintain(store).catch((e) => console.log(`   ⚠ maintenance skipped: ${(e as Error).message}`));
  const res = await runDaily(store, { force, skipEmail });
  if (res.skipped) {
    console.log(`Run for ${res.runDate} already completed (idempotent). Use --force to re-run.`);
  } else {
    console.log(`✅ Digest for ${res.runDate}: ${res.digestPath}`);
    console.log(`   ${res.companiesScored} scored · emailed=${res.emailed} · ${res.fetches} fetches`);
  }
  store.close();
}

function cmdServe(port?: string) {
  const value = port === undefined ? 3000 : Number(port);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) throw new Error("--port must be a valid port number.");
  startServer(value);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseFlags(rest);
  switch (cmd) {
    case "jobs": await cmdJobs(positional[0]!, flags.provider as AtsProvider | undefined); break;
    case "detect": await cmdDetect(positional[0]!); break;
    case "seed": cmdSeed(positional[0]); break;
    case "discover": await cmdDiscover(); break;
    case "run": await cmdRun("force" in flags, "discover" in flags, "no-email" in flags); break;
    case "serve": cmdServe(flags.port); break;
    case "review": cmdReview(); break;
    case "list": cmdList(); break;
    case "resolve": await cmdResolve(); break;
    default:
      console.log("Usage: bun run scan <run|discover|resolve|seed|jobs|detect|review|list|serve> [slug] [--provider p] [--force] [--discover] [--no-email] [--port N]");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
