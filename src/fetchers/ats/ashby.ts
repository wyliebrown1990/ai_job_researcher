// Ashby job-board fetcher. Validated endpoint (E1):
//   https://api.ashbyhq.com/posting-api/job-board/{slug}
// Use the JSON API, never the JS-rendered HTML page (E1/E3).

import type { JobPosting } from "../../types.ts";
import { fetchJson, nowIso } from "../http.ts";

interface AshbyJob {
  id?: string;
  title?: string;
  location?: string;
  department?: string;
  team?: string;
  employmentType?: string;
  isRemote?: boolean;
  publishedAt?: string;
  publishedDate?: string;
  jobUrl?: string;
  applyUrl?: string;
  descriptionPlain?: string;
  descriptionHtml?: string;
}
interface AshbyResponse {
  jobs?: AshbyJob[];
}

export async function fetchAshby(slug: string): Promise<JobPosting[]> {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}?includeCompensation=false`;
  const data = await fetchJson<AshbyResponse>(url);
  const retrievedAt = nowIso();
  const jobs = data.jobs ?? [];
  return jobs.map((j, i): JobPosting => ({
    externalId: j.id ?? `${slug}:${i}`,
    title: j.title ?? "",
    team: j.team ?? j.department,
    location: j.location ?? "",
    isRemote: j.isRemote,
    employmentType: j.employmentType,
    publishedDate: isoDate(j.publishedAt ?? j.publishedDate),
    url: j.jobUrl ?? j.applyUrl ?? "",
    descriptionText: j.descriptionPlain ?? stripHtml(j.descriptionHtml),
    retrievedAt,
  }));
}

function isoDate(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
}
function stripHtml(html: string | undefined): string | undefined {
  if (!html) return undefined;
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
