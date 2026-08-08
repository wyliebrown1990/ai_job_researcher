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
