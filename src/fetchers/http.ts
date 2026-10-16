// Minimal HTTP helper with a per-run fetch budget and timeout (design §6).

import { config } from "../config.ts";

let fetchCount = 0;

export function fetchesUsed(): number {
  return fetchCount;
}
export function resetFetchBudget(): void {
  fetchCount = 0;
}

export class FetchBudgetError extends Error {}
export class HttpError extends Error {
  constructor(public status: number, url: string) {
    super(`HTTP ${status} for ${url}`);
  }
}

export async function fetchJson<T = unknown>(url: string, timeoutMs = 15_000, headers: Record<string, string> = {}): Promise<T> {
  if (fetchCount >= config.limits.maxFetchesPerRun) {
    throw new FetchBudgetError(`fetch budget exhausted (${config.limits.maxFetchesPerRun})`);
  }
  fetchCount++;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { accept: "application/json", "user-agent": "ai-job-researcher/0.1", ...headers },
    });
    if (!res.ok) throw new HttpError(res.status, url);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export interface Page {
  /** Final URL after redirects (a redirect to another domain is meaningful to callers). */
  url: string;
  status: number;
  html: string;
}

/** Fetch an HTML page for resolution. Network failures return null; only the budget throws. */
export async function fetchPage(url: string, timeoutMs = 12_000): Promise<Page | null> {
  if (fetchCount >= config.limits.maxFetchesPerRun) {
    throw new FetchBudgetError(`fetch budget exhausted (${config.limits.maxFetchesPerRun})`);
  }
  fetchCount++;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "user-agent": "Mozilla/5.0 (compatible; ai-job-researcher/0.2; personal job research)",
      },
    });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || (type && !/html|xml|text\/plain/i.test(type))) return null;
    // Cap the body: homepages are small, and only links/meta are read.
    return { url: res.url || url, status: res.status, html: (await res.text()).slice(0, 1_500_000) };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}
