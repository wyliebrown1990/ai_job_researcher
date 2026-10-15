// Stage 2b: find a company's job board from its own website.
//
// The board identifier is read from links/embeds on the company's homepage or careers
// page (jobs.ashbyhq.com/acme, job-boards.greenhouse.io/acme, ...), so it is the
// company's real board rather than a slug that happens to exist. Guessing the slug is
// only a fallback, and a guessed board must mention the company before it is used.

import { config } from "../config.ts";
import type { AtsRef } from "../fetchers/ats/index.ts";
import { parsePage } from "../lib/html.ts";
import { companyKey } from "../lib/identity.ts";
import type { AtsProvider, JobPosting } from "../types.ts";
import { hostMatchesName, nameSlugs, textNamesCompany, type PageFetcher } from "./domain.ts";

export type BoardFetcher = (ref: AtsRef) => Promise<JobPosting[]>;

export interface CareersDeps {
  fetchPage: PageFetcher;
  fetchBoard: BoardFetcher;
}

export interface CareersResult {
  ats?: AtsRef;
  jobs?: JobPosting[];
  source?: "homepage-link" | "careers-page" | "slug-guess";
  careersUrl?: string;
  /** A recognised ATS with no reader here; its careers page is still recorded. */
  unsupportedAts?: string;
}

type Readable = Exclude<AtsProvider, "unknown">;

/** Boards we can read. Each pattern captures the board slug. */
const READABLE: { provider: Readable; re: RegExp }[] = [
  { provider: "greenhouse", re: /(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_board(?:\/js)?\?for=)?([A-Za-z0-9_-]+)/g },
  { provider: "greenhouse", re: /boards-api\.greenhouse\.io\/v1\/boards\/([A-Za-z0-9_-]+)/g },
  { provider: "ashby", re: /jobs\.ashbyhq\.com\/([A-Za-z0-9._%-]+)/g },
  { provider: "ashby", re: /api\.ashbyhq\.com\/posting-api\/job-board\/([A-Za-z0-9._%-]+)/g },
  { provider: "lever", re: /jobs\.(?:eu\.)?lever\.co\/([A-Za-z0-9._-]+)/g },
  { provider: "lever", re: /api\.lever\.co\/v0\/postings\/([A-Za-z0-9._-]+)/g },
  { provider: "workable", re: /apply\.workable\.com\/([A-Za-z0-9_-]+)/g },
  { provider: "workable", re: /\b([a-z0-9-]+)\.workable\.com/g },
  { provider: "rippling", re: /ats\.rippling\.com\/([A-Za-z0-9_-]+)/g },
];

/** Recognised boards without a reader: recorded so the careers page isn't lost. */
const UNREADABLE: { name: string; re: RegExp }[] = [
  { name: "bamboohr", re: /[a-z0-9-]+\.bamboohr\.com\/(?:careers|jobs)/ },
  { name: "gem", re: /jobs\.gem\.com\/[A-Za-z0-9_-]+/ },
  { name: "dover", re: /app\.dover\.com\/(?:jobs|apply)\/[A-Za-z0-9_-]+/ },
  { name: "teamtailor", re: /[a-z0-9-]+\.teamtailor\.com/ },
  { name: "recruitee", re: /[a-z0-9-]+\.recruitee\.com/ },
  { name: "smartrecruiters", re: /(?:jobs|careers)\.smartrecruiters\.com\/[A-Za-z0-9_-]+/ },
  { name: "workday", re: /[a-z0-9-]+\.wd\d+\.myworkdayjobs\.com/ },
  { name: "pinpoint", re: /[a-z0-9-]+\.pinpointhq\.com/ },
  { name: "breezy", re: /[a-z0-9-]+\.breezy\.hr/ },
  { name: "jazzhr", re: /[a-z0-9-]+\.applytojob\.com/ },
  { name: "wellfound", re: /wellfound\.com\/company\/[A-Za-z0-9_-]+\/jobs/ },
  { name: "ycombinator", re: /ycombinator\.com\/companies\/[A-Za-z0-9_-]+\/jobs/ },
  { name: "notion", re: /[a-z0-9-]+\.notion\.site/ },
];

const NOT_SLUGS = new Set(["embed", "api", "apply", "www", "jobs", "j", "careers", "v0", "v1", "static", "assets", "widget"]);
const CAREERS_PATH_RE = /\/(careers?|jobs|join(?:-us)?|hiring|work-with-us|open-roles|positions|opportunities)(?:[/?#.]|$)/i;
const CAREERS_TEXT_RE = /\b(careers?|jobs|join (?:us|the team|our team)|we'?re hiring|open (?:roles|positions)|work with us)\b/i;

function safeDecode(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

/** Every readable board referenced anywhere in the page (links, iframes, scripts). */
export function findBoardRefs(html: string): AtsRef[] {
  const refs: AtsRef[] = [];
  for (const { provider, re } of READABLE) {
    for (const match of html.matchAll(re)) {
      const slug = safeDecode(match[1]!).replace(/\.+$/, "");
      if (!slug || NOT_SLUGS.has(slug.toLowerCase())) continue;
      if (!refs.some((ref) => ref.provider === provider && ref.slug.toLowerCase() === slug.toLowerCase())) refs.push({ provider, slug });
    }
  }
  return refs;
}

export function findUnreadableAts(html: string): string | undefined {
  return UNREADABLE.find(({ re }) => re.test(html))?.name;
}

/** Careers links on the company's own site or a careers/jobs subdomain, best first. */
export function careersLinks(html: string, pageUrl: string, domain: string): string[] {
  const scored: { url: string; score: number }[] = [];
  for (const link of parsePage(html, pageUrl).links) {
    let host = "";
    try { host = new URL(link.href).hostname.toLowerCase().replace(/^www\./, ""); } catch { continue; }
    const ownSite = companyKey(link.href) === domain || host.endsWith(`.${domain}`);
    if (!ownSite) continue;
    const path = new URL(link.href).pathname;
    let score = 0;
    if (CAREERS_PATH_RE.test(path)) score += 2;
    if (CAREERS_TEXT_RE.test(link.text)) score += 2;
    if (/^(careers|jobs)\./.test(host)) score += 3;
    if (score && !scored.some((item) => item.url === link.href)) scored.push({ url: link.href.replace(/#.*$/, ""), score });
  }
  return scored.sort((a, b) => b.score - a.score).map((item) => item.url);
}

/** A guessed board is only trusted if its postings mention the company. */
export function boardMentionsCompany(jobs: JobPosting[], domain: string, name: string): boolean {
  return jobs.some((job) => {
    const text = `${job.descriptionText ?? ""} ${job.url}`;
    return text.toLowerCase().includes(domain) || textNamesCompany(text, name);
  });
}

async function firstWorkingBoard(html: string, deps: CareersDeps): Promise<{ ref: AtsRef; jobs: JobPosting[] } | null> {
  for (const ref of findBoardRefs(html)) {
    try {
      return { ref, jobs: await deps.fetchBoard(ref) };
    } catch {
      // A stale link to an old board: try the next reference.
    }
  }
  return null;
}

export async function findCareers(domain: string, displayName: string, deps: CareersDeps): Promise<CareersResult> {
  const home = await deps.fetchPage(`https://${domain}/`);
  let careersUrl: string | undefined;
  let unsupportedAts: string | undefined;

  if (home) {
    const direct = await firstWorkingBoard(home.html, deps);
    if (direct) return { ats: direct.ref, jobs: direct.jobs, source: "homepage-link", careersUrl: careersLinks(home.html, home.url, domain)[0] };
    unsupportedAts = findUnreadableAts(home.html);
    const queue = careersLinks(home.html, home.url, domain);
    for (const fallback of [`https://${domain}/careers`, `https://${domain}/jobs`]) if (!queue.includes(fallback)) queue.push(fallback);
    for (const url of queue.slice(0, config.resolve.maxCareersPages)) {
      const page = await deps.fetchPage(url);
      if (!page) continue;
      careersUrl ??= page.url;
      const board = await firstWorkingBoard(page.html, deps);
      if (board) return { ats: board.ref, jobs: board.jobs, source: "careers-page", careersUrl: page.url };
      unsupportedAts ??= findUnreadableAts(page.html);
      // A careers page that links out to a board host (e.g. a "View openings" button).
      for (const link of parsePage(page.html, page.url).links) {
        const linked = findBoardRefs(link.href)[0];
        if (!linked) continue;
        try {
          return { ats: linked, jobs: await deps.fetchBoard(linked), source: "careers-page", careersUrl: page.url };
        } catch {
          // keep looking
        }
      }
    }
  }
  if (unsupportedAts) return { careersUrl, unsupportedAts };

  // Fallback: slug guesses, verified against the postings themselves.
  const label = domain.split(".")[0]!;
  const slugs = [...new Set([label, ...nameSlugs(displayName)].filter((slug) => hostMatchesName(`${slug}.x`, displayName) || slug === label))];
  for (const slug of slugs) {
    for (const provider of ["ashby", "greenhouse", "lever"] as const) {
      try {
        const jobs = await deps.fetchBoard({ provider, slug });
        if (jobs.length && boardMentionsCompany(jobs, domain, displayName)) {
          return { ats: { provider, slug }, jobs, source: "slug-guess", careersUrl };
        }
      } catch {
        // no such board
      }
    }
  }
  return { careersUrl };
}
