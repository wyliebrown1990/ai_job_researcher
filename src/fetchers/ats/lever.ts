// Lever job-board fetcher.
//   https://api.lever.co/v0/postings/{company}?mode=json

import type { JobPosting } from "../../types.ts";
import { fetchJson, nowIso } from "../http.ts";

interface LeverJob {
  id?: string;
  text?: string; // title
  categories?: { team?: string; location?: string; commitment?: string; department?: string };
  hostedUrl?: string;
  applyUrl?: string;
  createdAt?: number; // epoch ms
  descriptionPlaintext?: string;
  description?: string;
  workplaceType?: string;
}

export async function fetchLever(company: string): Promise<JobPosting[]> {
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(company)}?mode=json`;
  const data = await fetchJson<LeverJob[]>(url);
  const retrievedAt = nowIso();
  return (data ?? []).map((j, i): JobPosting => ({
    externalId: j.id ?? `${company}:${i}`,
    title: j.text ?? "",
    team: j.categories?.team ?? j.categories?.department,
    location: j.categories?.location ?? "",
    isRemote: j.workplaceType ? /remote/i.test(j.workplaceType) : undefined,
    employmentType: j.categories?.commitment,
    publishedDate: j.createdAt ? new Date(j.createdAt).toISOString().slice(0, 10) : undefined,
    url: j.hostedUrl ?? j.applyUrl ?? "",
    descriptionText: j.descriptionPlaintext ?? stripHtml(j.description),
    retrievedAt,
  }));
}

function stripHtml(html: string | undefined): string | undefined {
  if (!html) return undefined;
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
