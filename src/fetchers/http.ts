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

export async function fetchJson<T = unknown>(url: string, timeoutMs = 15_000): Promise<T> {
  if (fetchCount >= config.limits.maxFetchesPerRun) {
    throw new FetchBudgetError(`fetch budget exhausted (${config.limits.maxFetchesPerRun})`);
  }
  fetchCount++;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { accept: "application/json", "user-agent": "ai-job-researcher/0.1" },
    });
    if (!res.ok) throw new HttpError(res.status, url);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}
