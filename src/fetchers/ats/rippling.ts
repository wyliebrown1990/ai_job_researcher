// Rippling ATS job-board fetcher (public board API, no key):
//   https://api.rippling.com/platform/api/ats/v1/board/{slug}/jobs
// Boards are found from ats.rippling.com/{slug} links on careers pages. The response
// shape is parsed tolerantly; unknown fields are ignored rather than trusted.

import type { JobPosting } from "../../types.ts";
import { fetchJson, nowIso } from "../http.ts";

interface RipplingJob {
  uuid?: string;
  id?: string;
  name?: string;
  title?: string;
  url?: string;
  department?: { label?: string } | string;
  workLocation?: { label?: string } | string;
  workLocations?: string[];
}

function label(value: { label?: string } | string | undefined): string {
  return typeof value === "string" ? value : value?.label ?? "";
}

export function mapRippling(slug: string, data: RipplingJob[] | { items?: RipplingJob[] }, retrievedAt = nowIso()): JobPosting[] {
  const jobs = Array.isArray(data) ? data : data.items ?? [];
  return jobs.map((j, i): JobPosting => {
    const location = j.workLocations?.join("; ") || label(j.workLocation);
    const id = j.uuid ?? j.id ?? `${slug}:${i}`;
    return {
      externalId: id,
      title: j.name ?? j.title ?? "",
      team: label(j.department) || undefined,
      location,
      isRemote: /\bremote\b/i.test(location) || undefined,
      url: j.url ?? `https://ats.rippling.com/${slug}/jobs/${id}`,
      retrievedAt,
    };
  });
}

export async function fetchRippling(slug: string): Promise<JobPosting[]> {
  const url = `https://api.rippling.com/platform/api/ats/v1/board/${encodeURIComponent(slug)}/jobs`;
  return mapRippling(slug, await fetchJson<RipplingJob[] | { items?: RipplingJob[] }>(url));
}
