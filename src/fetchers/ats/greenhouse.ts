// Greenhouse job-board fetcher. Validated endpoint (E3):
//   https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true
// The HTML careers page is JS-rendered and dumps the whole board — use the JSON API.

import type { JobPosting } from "../../types.ts";
import { fetchJson, nowIso } from "../http.ts";

interface GhJob {
  id?: number;
  title?: string;
  updated_at?: string;
  first_published?: string;
  absolute_url?: string;
  location?: { name?: string };
  content?: string; // HTML-escaped JD when content=true
  departments?: { name?: string }[];
}
interface GhResponse {
  jobs?: GhJob[];
  meta?: { total?: number };
}

export async function fetchGreenhouse(token: string, withContent = true): Promise<JobPosting[]> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs${withContent ? "?content=true" : ""}`;
  const data = await fetchJson<GhResponse>(url);
  const retrievedAt = nowIso();
  const jobs = data.jobs ?? [];
  return jobs.map((j): JobPosting => ({
    externalId: String(j.id ?? ""),
    title: j.title ?? "",
    team: j.departments?.map((d) => d.name).filter(Boolean).join(", ") || undefined,
    location: j.location?.name ?? "",
    publishedDate: isoDate(j.first_published ?? j.updated_at),
    url: j.absolute_url ?? "",
    descriptionText: decodeAndStrip(j.content),
    retrievedAt,
  }));
}

function isoDate(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
}
function decodeAndStrip(content: string | undefined): string | undefined {
  if (!content) return undefined;
  const decoded = content
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&nbsp;/g, " ");
  return decoded.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
