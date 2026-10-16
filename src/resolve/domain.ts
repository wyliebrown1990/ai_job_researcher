// Stage 2: resolve a discovered company name to its own primary domain.
//
// Discovery is news-oriented, so a candidate often arrives with a name, a description
// and press/news source URLs but no domain. This resolver finds candidate domains the
// way a person would — links in the sources, the obvious name-based domains, then a
// search — and accepts none of them until the live homepage verifies: it must be
// reachable, not parked, and name the company (plus context from the story for weaker
// leads). Guessing is allowed; using an unverified guess is not (E4).

import { config } from "../config.ts";
import type { Page } from "../fetchers/http.ts";
import { parsePage, type ParsedPage } from "../lib/html.ts";
import { companyKey, coreNameTokens, nameTokens } from "../lib/identity.ts";
import type { DomainCandidateSummary, DomainMethod } from "../types.ts";

export type PageFetcher = (url: string) => Promise<Page | null>;

export interface ResolveInput {
  displayName: string;
  description?: string;
  category?: string;
  domain?: string;
  website?: string;
  websiteSourceUrl?: string;
  sources: { url: string }[];
}

export interface SearchHit {
  url: string;
  method: "search" | "llm";
  evidenceUrl?: string;
}

export interface DomainResolverDeps {
  fetchPage: PageFetcher;
  /** Stage-3 fallback, called only when nothing cheaper verified. */
  search?: (input: ResolveInput) => Promise<SearchHit[]>;
  /** A domain this name verified to before (still re-verified here). */
  cachedDomain?: string;
}

export interface VerifiedCandidate extends DomainCandidateSummary {
  signals: string[];
}

export interface DomainResolution {
  /** Set only when the best candidate reaches config.resolve.autoAcceptConfidence. */
  domain?: string;
  method?: DomainMethod;
  confidence: number;
  evidenceUrl?: string;
  /** Verified candidates at or above suggestConfidence, best first. */
  candidates: VerifiedCandidate[];
}

/** How much a lead counts before its page is read. */
const METHOD_PRIOR: Record<DomainMethod, number> = {
  manual: 0.5,
  "source-link": 0.3,
  "source-host": 0.3,
  provided: 0.25,
  cache: 0.25,
  llm: 0.2,
  search: 0.1,
  guess: 0,
};

const STOPWORDS = new Set([
  "about", "after", "their", "which", "where", "while", "these", "those", "other", "under", "build", "builds",
  "building", "company", "companies", "startup", "platform", "raised", "raises", "funding", "round", "series",
  "million", "billion", "using", "based", "helps", "helping", "provides", "across", "through", "into", "with",
  "from", "that", "this", "artificial", "intelligence", "solution", "solutions", "leading", "founded",
  "announced", "investors", "venture", "capital", "seed", "enterprise", "enterprises",
]);

/** Titles that say nothing about whose site it is (common on JS-rendered pages). */
const GENERIC_TITLE_RE = /^(home|home page|welcome|index|loading|untitled|app|)$/i;
/** Signal: the page title names something other than this company. */
export const OTHER_TITLE = "title names another company";

const PARKED_RE = /\b(this domain (?:name )?(?:is|may be) for sale|buy this domain|domain (?:is )?for sale|parked (?:free|domain)|domain parking|make an offer on this domain|hugedomains|sedoparking|parkingcrew|bodis\.com|afternic|dan\.com)\b/i;
const PARKING_HOSTS = ["sedo.com", "dan.com", "afternic.com", "hugedomains.com", "godaddy.com", "parkingcrew.net", "bodis.com", "namecheap.com", "squarespace.com"];

export function isNonCompanyHost(host: string): boolean {
  return [...config.resolve.nonCompanyHosts, ...PARKING_HOSTS].some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
}

/** Name slugs used for domain labels: "Assort Health" → assorthealth, assort-health. */
export function nameSlugs(name: string): string[] {
  const full = nameTokens(name);
  const core = coreNameTokens(name);
  return [...new Set([core.join(""), full.join(""), core.join("-"), full.join("-")])].filter((slug) => slug.length >= 2);
}

/** Obvious name-based domains, most likely first, to be verified one by one. */
export function guessDomains(name: string, max = config.resolve.maxGuesses): string[] {
  const [core, full] = nameSlugs(name);
  if (!core) return [];
  const out = [`${core}.ai`, `${core}.com`, `${core}.io`, `get${core}.com`, `try${core}.com`, `${core}.co`, `${core}ai.com`, `${core}hq.com`];
  if (full && full !== core) out.splice(2, 0, `${full}.com`, `${full}.ai`);
  return [...new Set(out)].slice(0, max);
}

function squash(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Does free text name the company? Short names need a word boundary, not a substring. */
export function textNamesCompany(text: string, name: string): boolean {
  const core = coreNameTokens(name);
  const phrase = core.join(" ");
  if (!phrase) return false;
  if (phrase.replace(/ /g, "").length <= 4) {
    return new RegExp(`(^|[^a-z0-9])${phrase.replace(/ /g, "[\\s-]?")}([^a-z0-9]|$)`, "i").test(text);
  }
  return squash(text).includes(core.join(""));
}

/** Is the domain's first label built from the name (acme, getacme, acmeai, acme-hq)? */
export function hostMatchesName(domain: string, name: string): boolean {
  const label = domain.split(".")[0]!.replace(/-/g, "");
  return nameSlugs(name).map((slug) => slug.replace(/-/g, "")).some((slug) =>
    label === slug
    || label.replace(/^(get|try|use|join|with|go|hello|meet)/, "") === slug
    || label.replace(/(ai|hq|app|labs|inc|io)$/, "") === slug);
}

function contextKeywords(input: ResolveInput): string[] {
  const own = new Set(nameTokens(input.displayName));
  const words = `${input.description ?? ""} ${input.category ?? ""}`.toLowerCase().match(/[a-z][a-z-]{4,}/g) ?? [];
  return [...new Set(words.filter((word) => !STOPWORDS.has(word) && !own.has(word)))].slice(0, 15);
}

function isParked(page: Page, parsed: ParsedPage): boolean {
  const host = companyKey(page.url) ?? "";
  return PARKING_HOSTS.some((parking) => host === parking || host.endsWith(`.${parking}`))
    || PARKED_RE.test(`${parsed.title} ${parsed.text.slice(0, 5000)}`);
}

/** Read the homepage and score how strongly it is this company's own site. */
export async function verifyDomain(
  domain: string,
  method: DomainMethod,
  input: ResolveInput,
  fetchPage: PageFetcher,
  evidenceUrl?: string,
): Promise<VerifiedCandidate | null> {
  const page = await fetchPage(`https://${domain}/`);
  if (!page) return null;
  const finalHost = companyKey(page.url);
  if (!finalHost || isNonCompanyHost(finalHost)) return null;
  const parsed = parsePage(page.html, page.url);
  if (isParked(page, parsed)) return null;

  const signals: string[] = [];
  let score = METHOD_PRIOR[method];
  const named = textNamesCompany(`${parsed.title} ${parsed.siteName}`, input.displayName);
  if (named) { score += 0.4; signals.push("name in page title"); }
  else if (textNamesCompany(`${parsed.description} ${parsed.text.slice(0, 3000)}`, input.displayName)) {
    score += 0.15;
    signals.push("name on page");
  }
  if (!named && !GENERIC_TITLE_RE.test(parsed.title.replace(/[^a-z ]/gi, " ").trim())) signals.push(OTHER_TITLE);
  const hostNamed = hostMatchesName(finalHost, input.displayName);
  if (hostNamed) { score += 0.2; signals.push("domain matches name"); }
  const haystack = `${parsed.description} ${parsed.text}`;
  const keywordHits = contextKeywords(input).filter((word) => haystack.includes(word)).length;
  if (keywordHits) { score += Math.min(0.25, keywordHits * 0.06); signals.push(`${keywordHits} context keyword(s)`); }
  if (method !== "manual" && !signals.some((signal) => signal.startsWith("name"))) score = Math.min(score, 0.3);
  // A one-word name ("June", "Volta") verified only by its own domain label could be anyone.
  const generic = coreNameTokens(input.displayName).join("").length <= 6 && coreNameTokens(input.displayName).length === 1;
  if (generic && (method === "guess" || method === "search") && keywordHits === 0) score = Math.min(score, 0.5);

  if (finalHost !== domain) signals.push(`redirects from ${domain}`);
  return { domain: finalHost, method, confidence: Math.round(Math.min(1, score) * 100) / 100, evidenceUrl, signals };
}

/** Mine the discovery sources: a source on the company's own site, or links out to it. */
async function sourceLeads(input: ResolveInput, fetchPage: PageFetcher): Promise<Map<string, string>> {
  const leads = new Map<string, string>(); // domain -> evidence URL
  const urls = [...new Set([input.websiteSourceUrl, ...input.sources.map((source) => source.url)].filter((url): url is string => Boolean(url)))];
  for (const url of urls.slice(0, config.resolve.maxSourcePages)) {
    const sourceHost = companyKey(url);
    if (sourceHost && !isNonCompanyHost(sourceHost) && hostMatchesName(sourceHost, input.displayName)) leads.set(sourceHost, url);
    const page = await fetchPage(url);
    if (!page) continue;
    for (const link of parsePage(page.html, page.url).links) {
      const host = companyKey(link.href);
      if (!host || host === sourceHost || isNonCompanyHost(host) || leads.has(host)) continue;
      if (textNamesCompany(link.text, input.displayName) || hostMatchesName(host, input.displayName)) leads.set(host, url);
    }
  }
  return leads;
}

export async function resolveDomain(input: ResolveInput, deps: DomainResolverDeps): Promise<DomainResolution> {
  const verified = new Map<string, VerifiedCandidate>();
  const tried = new Set<string>();
  const best = () => [...verified.values()].sort((a, b) => b.confidence - a.confidence)[0];
  const done = () => (best()?.confidence ?? 0) >= config.resolve.autoAcceptConfidence;

  const tryLead = async (raw: string | undefined, method: DomainMethod, evidenceUrl?: string) => {
    const domain = companyKey(raw);
    if (!domain || tried.has(domain) || isNonCompanyHost(domain)) return;
    tried.add(domain);
    const result = await verifyDomain(domain, method, input, deps.fetchPage, evidenceUrl);
    if (!result) return;
    const prior = verified.get(result.domain);
    if (!prior || prior.confidence < result.confidence) verified.set(result.domain, result);
  };

  // 1. Leads we were handed: the model's domain/website, or a past verified resolution.
  await tryLead(input.domain, "provided", input.websiteSourceUrl);
  await tryLead(input.website, "provided", input.websiteSourceUrl);
  await tryLead(deps.cachedDomain, "cache");
  // 2. The discovery sources themselves.
  if (!done()) {
    for (const [domain, evidenceUrl] of await sourceLeads(input, deps.fetchPage)) {
      await tryLead(domain, companyKey(evidenceUrl) === domain ? "source-host" : "source-link", evidenceUrl);
      if (done()) break;
    }
  }
  // 3. Obvious name-based domains.
  if (!done()) {
    for (const domain of guessDomains(input.displayName)) {
      await tryLead(domain, "guess");
      if (done()) break;
    }
  }
  // 4. Search fallback (stage 3).
  if (!done() && deps.search) {
    for (const hit of await deps.search(input).catch(() => [])) {
      await tryLead(hit.url, hit.method, hit.evidenceUrl ?? hit.url);
      if (done()) break;
    }
  }

  const top = best();
  const candidates = [...verified.values()]
    .filter((candidate) => candidate.confidence >= config.resolve.suggestConfidence)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5);
  if (top && done()) return { domain: top.domain, method: top.method, confidence: top.confidence, evidenceUrl: top.evidenceUrl, candidates };
  return { confidence: top?.confidence ?? 0, candidates };
}
