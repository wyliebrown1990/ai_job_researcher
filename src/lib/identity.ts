// Company identity & dedup (E4).
// Canonical key = normalized primary domain. NEVER the display name — companies
// appear as "HappyRobot" / "Happyrobot Inc." / "happyrobot.ai" across sources, and
// generic names ("June") collide with unrelated entities.

/**
 * Normalize a URL or bare domain to a canonical registrable-ish domain:
 * lowercased, no protocol/path/port, no leading `www.`.
 *
 * NOTE: this is a pragmatic normalizer, not a full Public-Suffix-List resolver, so
 * `jobs.acme.com` and `acme.com` both reduce to their host minus `www`. For dedup we
 * additionally strip a single leading known-subdomain (see `registrableDomain`).
 * Returns null when nothing domain-like can be extracted.
 */
export function normalizeDomain(input: string | undefined | null): string | null {
  if (!input) return null;
  let s = input.trim().toLowerCase();
  if (!s) return null;

  // Strip protocol.
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  // Strip everything after the first path/query/hash separator.
  s = s.split(/[/?#]/, 1)[0] ?? s;
  // Strip userinfo and port.
  s = s.split("@").pop() ?? s;
  s = s.split(":", 1)[0] ?? s;
  // Strip leading www.
  s = s.replace(/^www\./, "");

  // Must look like a domain (at least one dot, valid chars).
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s)) return null;
  return s;
}

const COMMON_SUBDOMAINS = new Set([
  "jobs", "careers", "boards", "app", "www", "get", "try", "hq", "go", "mail",
]);

/**
 * Reduce a host to a registrable domain for dedup by dropping a single leading
 * common subdomain (jobs./careers./app.) when the remainder still has a dot.
 */
export function registrableDomain(input: string | undefined | null): string | null {
  const host = normalizeDomain(input);
  if (!host) return null;
  const parts = host.split(".");
  if (parts.length > 2 && COMMON_SUBDOMAINS.has(parts[0]!)) {
    return parts.slice(1).join(".");
  }
  return host;
}

/** The canonical dedup key for a company. */
export function companyKey(domain: string | undefined | null): string | null {
  return registrableDomain(domain);
}

/** Case-insensitive, order-preserving alias merge (no duplicates). */
export function mergeAliases(existing: string[], incoming: string[]): string[] {
  const seen = new Set(existing.map((a) => a.toLowerCase()));
  const out = [...existing];
  for (const a of incoming) {
    const name = a.trim();
    if (name && !seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      out.push(name);
    }
  }
  return out;
}

/**
 * Decide whether two candidates are the same company.
 * Domain match => same. No shared domain => NOT auto-merged (E4: never merge on
 * display name alone). Returns "same" | "different" | "unknown".
 */
export function sameCompany(
  a: { domain?: string | null },
  b: { domain?: string | null },
): "same" | "different" | "unknown" {
  const ka = companyKey(a.domain);
  const kb = companyKey(b.domain);
  if (ka && kb) return ka === kb ? "same" : "different";
  return "unknown"; // no domain on one side -> caller routes to review queue
}

const CORPORATE_SUFFIXES = new Set(["inc", "incorporated", "llc", "ltd", "limited", "corp", "corporation", "co", "company", "gmbh", "plc", "sa"]);
/** Trailing words that vary between mentions of the same company ("June" / "June AI"). */
const SOFT_SUFFIXES = new Set(["ai", "labs", "lab", "hq", "technologies", "technology", "tech"]);

/** Lowercase name words without parentheticals or corporate suffixes. */
export function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/&/g, " and ")
    .split(/[^a-z0-9]+/)
    .filter((token) => token && !CORPORATE_SUFFIXES.has(token));
}

/** Name tokens with soft suffixes dropped, keeping at least one token. */
export function coreNameTokens(name: string): string[] {
  const tokens = nameTokens(name);
  while (tokens.length > 1 && SOFT_SUFFIXES.has(tokens.at(-1)!)) tokens.pop();
  return tokens;
}

/**
 * Loose name key for grouping review-queue items ("June AI" and "June" share one).
 * Only for collapsing to-do items — never for merging companies (E4).
 */
export function nameKey(name: string): string {
  return coreNameTokens(name).join("");
}
