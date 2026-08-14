// RANK & DIGEST (design N9). Renders the scored watchlist into the daily markdown.
// Sections mirror the design: pulse, new entrants, top movers, funding, notable-but-
// unproven, roles-for-you, review queue. Every surfaced entry carries dated evidence.

import type { Application, Company, RoleMatch, ReviewItem, FundingEvent } from "./types.ts";
import { config } from "./config.ts";

export interface CompanyDigest {
  company: Company;
  matches: RoleMatch[];
}
export interface DigestInput {
  runDate: string; // YYYY-MM-DD
  companies: CompanyDigest[];
  reviewItems: ReviewItem[];
  savedRoles?: { company: Company; match: RoleMatch }[];
  dueActions?: Application[];
  now: Date;
}

function usd(n: number | undefined): string {
  if (!n) return "undisclosed";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(n % 1e9 === 0 ? 0 : 1)}B`;
  if (n >= 1e6) return `$${Math.round(n / 1e6)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${n}`;
}

function daysBetween(aIso: string, b: Date): number {
  const a = new Date(aIso + (aIso.length <= 10 ? "T00:00:00Z" : "")).getTime();
  return (b.getTime() - a) / 86_400_000;
}

function scoreLine(c: Company): string {
  const s = c.score?.score ?? 0;
  const conf = c.score?.confidence ?? "low";
  let delta = "";
  if (c.priorScore !== undefined && c.priorScore !== s) {
    const d = s - c.priorScore;
    delta = ` ${d > 0 ? "▲" : "▼"}${Math.abs(d)}`;
  } else if (c.priorScore === undefined) {
    delta = " ·NEW";
  }
  return `**${s}/100**${delta} · conf ${conf}`;
}

function fundingLine(f: FundingEvent): string {
  const parts = [f.stage.replace(/-/g, " "), usd(f.amountUsd)];
  if (f.valuationUsd) parts.push(`@ ${usd(f.valuationUsd)} val`);
  const leads = f.leadInvestors.length ? ` — led by ${f.leadInvestors.join(", ")}` : "";
  return `${parts.join(" ")}${leads} (${f.announcedDate})`;
}

function evidenceRefs(c: Company, max = 3): string {
  const refs = c.evidence.slice(0, max).map((e) => `[${new URL(e.sourceUrl).hostname.replace(/^www\./, "")}](${e.sourceUrl})`);
  return refs.length ? `  \n  ↳ ${refs.join(" · ")}` : "";
}

function companyBlock(cd: CompanyDigest): string {
  const c = cd.company;
  const lines: string[] = [];
  lines.push(`### ${c.displayName} — ${scoreLine(c)}`);
  if (c.description) lines.push(c.description);
  if (c.latestFunding) lines.push(`- 💰 ${fundingLine(c.latestFunding)}`);
  if (c.openRolesCount !== undefined) {
    const delta = c.priorOpenRolesCount !== undefined ? ` (was ${c.priorOpenRolesCount})` : "";
    lines.push(`- 📈 ${c.openRolesCount} open roles${delta}, ${cd.matches.length} matching your target titles`);
  }
  lines.push(`- 🔗 ${c.domain}${evidenceRefs(c)}`);
  return lines.join("\n");
}

function rolesForYou(companies: CompanyDigest[]): string {
  const withMatches = companies
    .filter((cd) => cd.matches.length > 0)
    .sort((a, b) => (b.matches[0]?.relevance?.score ?? 0) - (a.matches[0]?.relevance?.score ?? 0)
      || (b.company.score?.score ?? 0) - (a.company.score?.score ?? 0));
  if (!withMatches.length) return "_No matching roles open across the watchlist today._";

  const out: string[] = [];
  for (const cd of withMatches) {
    out.push(`**${cd.company.displayName}** (growth ${cd.company.score?.score ?? "—"})`);
    // De-dupe identical titles across many geos; show up to 6 distinct.
    const seen = new Set<string>();
    const distinct = cd.matches.filter((m) => {
      const k = m.job.title.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    for (const m of distinct.sort((a, b) => (b.relevance?.score ?? 0) - (a.relevance?.score ?? 0)).slice(0, 6)) {
      const caveat = m.fitCaveat ? `  \n  ⚠ ${m.fitCaveat}` : "";
      const date = m.job.publishedDate ? ` · ${m.job.publishedDate}` : "";
      const fit = m.relevance ? ` · fit ${m.relevance.score}/100 (${m.relevance.reasons.join("; ")})` : "";
      out.push(`- [${m.job.title}](${m.job.url}) — _${m.customTitlePhrase ?? m.role}_ · ${m.job.location || "—"}${date}${fit}${caveat}`);
    }
    const extra = distinct.length - 6;
    if (extra > 0) out.push(`- …and ${extra} more distinct role(s)`);
    out.push("");
  }
  return out.join("\n");
}

function section(title: string, blocks: string[], emptyMsg: string): string {
  const body = blocks.length ? blocks.join("\n\n") : `_${emptyMsg}_`;
  return `## ${title}\n\n${body}\n`;
}

function savedRolesAndActions(
  savedRoles: { company: Company; match: RoleMatch }[],
  dueActions: Application[],
): string {
  const lines = [
    ...savedRoles.map(({ company, match }) =>
      "- Saved: [" + match.job.title + "](" + match.job.url + ") at **" + company.displayName + "**",
    ),
    ...dueActions.map((application) =>
      "- Due " + application.nextActionAt + ": **" + application.domain + "** · " + application.status
        + (application.notes ? " — " + application.notes : ""),
    ),
  ];
  return lines.length ? "## Saved roles & due actions\n\n" + lines.join("\n") + "\n" : "";
}

export function renderDigest(input: DigestInput): string {
  const { companies, reviewItems, now, runDate, savedRoles = [], dueActions = [] } = input;
  const byBucket = (b: string) => companies.filter((cd) => cd.company.score?.bucket === b);

  const topMovers = byBucket("top-mover").sort((a, b) => (b.company.score?.score ?? 0) - (a.company.score?.score ?? 0));
  const newEntrants = byBucket("new-entrant");
  const notable = byBucket("notable-unproven");
  const following = companies.filter((cd) => {
    const company = cd.company;
    const scoreChanged = company.priorScore !== undefined && company.priorScore !== company.score?.score;
    const hiringChanged = company.priorOpenRolesCount !== undefined
      && company.priorOpenRolesCount !== company.openRolesCount;
    const freshFunding = company.latestFunding
      && daysBetween(company.latestFunding.announcedDate, now) <= config.staleness.fundingActiveDays + 1;
    return company.pinned && (scoreChanged || hiringChanged || Boolean(freshFunding) || cd.matches.length > 0);
  });

  const recentFunding = companies.filter((cd) => {
    const f = cd.company.latestFunding;
    return f && daysBetween(f.announcedDate, now) <= config.staleness.fundingActiveDays + 1;
  });

  const totalMatches = companies.reduce((n, cd) => n + cd.matches.length, 0);

  const pulse = [
    `- **${companies.length}** companies tracked`,
    `- **${recentFunding.length}** funding event(s) in the last ~48h`,
    `- **${topMovers.length}** top mover(s) by quantifiable growth`,
    `- **${totalMatches}** open role(s) matching your target titles`,
    `- **${reviewItems.length}** item(s) in the review queue`,
  ].join("\n");

  return [
    `# AI Industry Research — Daily Digest`,
    `_${runDate}_`,
    ``,
    `## Industry pulse`,
    ``,
    pulse,
    ``,
    section("New entrants", newEntrants.map(companyBlock), "None new today."),
    section("Top movers", topMovers.map(companyBlock), "No quantifiable-growth movers today."),
    section("Funding in the last ~48h", recentFunding.map(companyBlock), "No new funding events."),
    section("Notable but unproven", notable.map(companyBlock),
      "None — funded-but-unproven companies appear here, never as top movers (E2)."),
    section("Following", following.map(companyBlock), "No material changes at followed companies today."),
    `## Roles for you\n\n${rolesForYou(companies)}`,
    savedRolesAndActions(savedRoles, dueActions),
    section("Review queue", reviewItems.map((r) => `- **[${r.reason}]** ${r.displayName} — ${r.detail}`),
      "Empty — nothing needs your review."),
    `---`,
    `_Every entry above is backed by a dated source. Funding rumors and unverifiable`,
    `claims are held in the review queue, never scored as growth._`,
    ``,
  ].join("\n");
}
