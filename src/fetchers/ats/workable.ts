// Workable job-board fetcher (public widget API, no key):
//   https://apply.workable.com/api/v1/widget/accounts/{account}
// Accounts are found from apply.workable.com/{account} links on careers pages.

import type { JobPosting } from "../../types.ts";
import { fetchJson, nowIso } from "../http.ts";

interface WorkableJob {
  shortcode?: string;
  code?: string;
  title?: string;
  department?: string;
  employment_type?: string;
  telecommuting?: boolean;
  url?: string;
  shortlink?: string;
  published_on?: string;
  created_at?: string;
  city?: string;
  state?: string;
  country?: string;
  locations?: { city?: string; region?: string; country?: string; hidden?: boolean }[];
}
export interface WorkableResponse {
  name?: string;
  jobs?: WorkableJob[];
}

export function mapWorkable(account: string, data: WorkableResponse, retrievedAt = nowIso()): JobPosting[] {
  return (data.jobs ?? []).map((j, i): JobPosting => {
    const places = (j.locations?.length ? j.locations.filter((l) => !l.hidden) : [{ city: j.city, region: j.state, country: j.country }])
      .map((l) => [l.city, l.region, l.country].filter(Boolean).join(", "))
      .filter(Boolean);
    const location = [...places, j.telecommuting ? "Remote" : ""].filter(Boolean).join("; ");
    return {
      externalId: j.shortcode ?? j.code ?? `${account}:${i}`,
      title: j.title ?? "",
      team: j.department || undefined,
      location,
      isRemote: j.telecommuting || undefined,
      employmentType: j.employment_type || undefined,
      publishedDate: (j.published_on ?? j.created_at)?.slice(0, 10),
      url: j.url ?? j.shortlink ?? `https://apply.workable.com/${account}/j/${j.shortcode ?? ""}`,
      retrievedAt,
    };
  });
}

export async function fetchWorkable(account: string): Promise<JobPosting[]> {
  const url = `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(account)}`;
  return mapWorkable(account, await fetchJson<WorkableResponse>(url));
}
