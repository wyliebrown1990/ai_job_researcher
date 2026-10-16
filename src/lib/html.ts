// Minimal, dependency-free HTML reading for resolution: links, title/site name,
// meta description and visible text. Pages are only mined for these facts, so a
// tolerant regex reader is enough and keeps the deterministic layer testable offline.

export interface PageLink {
  href: string;
  text: string;
}

export interface ParsedPage {
  title: string;
  siteName: string;
  description: string;
  links: PageLink[];
  /** Visible text, lowercased and whitespace-collapsed, for keyword checks. */
  text: string;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", "#x27": "'" };

export function decodeEntities(value: string): string {
  return value
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+\d*);/gi, (match, code: string) => {
      const key = code.toLowerCase();
      if (ENTITIES[key] !== undefined) return ENTITIES[key]!;
      if (key.startsWith("#x")) return String.fromCodePoint(parseInt(key.slice(2), 16));
      if (key.startsWith("#")) return String.fromCodePoint(parseInt(key.slice(1), 10));
      return match;
    });
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function metaContent(html: string, key: string): string {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*>`, "i");
  const tag = html.match(re)?.[0];
  return tag ? decodeEntities(tag.match(/content=["']([^"']*)["']/i)?.[1] ?? "").trim() : "";
}

/** Resolve an href against the page URL; null for anchors, mailto:, javascript:, etc. */
export function absoluteUrl(href: string, base: string): string | null {
  const value = decodeEntities(href.trim());
  if (!value || /^(#|mailto:|tel:|javascript:|data:)/i.test(value)) return null;
  try {
    const url = new URL(value, base);
    return /^https?:$/.test(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

export function parsePage(html: string, baseUrl: string): ParsedPage {
  const links: PageLink[] = [];
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = match[1]!.match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
    const url = href ? absoluteUrl(href, baseUrl) : null;
    if (url) links.push({ href: url, text: stripTags(match[2]!).slice(0, 200) });
  }
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  return {
    title: stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ""),
    siteName: metaContent(html, "og:site_name") || metaContent(html, "application-name"),
    description: metaContent(html, "description") || metaContent(html, "og:description"),
    links,
    text: stripTags(body).toLowerCase().slice(0, 200_000),
  };
}
