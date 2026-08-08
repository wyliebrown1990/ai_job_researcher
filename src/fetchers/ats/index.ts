// Unified ATS interface. Postings churn fast (E3) — every fetch stamps retrievedAt
// and counts are taken from the ATS JSON, never from aggregators (E1).

import type { AtsProvider, JobPosting } from "../../types.ts";
import { fetchAshby } from "./ashby.ts";
import { fetchGreenhouse } from "./greenhouse.ts";
import { fetchLever } from "./lever.ts";

export interface AtsRef {
  provider: AtsProvider;
  slug: string;
}

export async function fetchBoard(ref: AtsRef): Promise<JobPosting[]> {
  switch (ref.provider) {
    case "ashby": return fetchAshby(ref.slug);
    case "greenhouse": return fetchGreenhouse(ref.slug);
    case "lever": return fetchLever(ref.slug);
    default: throw new Error(`unknown ATS provider: ${ref.provider}`);
  }
}

/** Try each provider with the given slug; return the first that yields postings. */
export async function detectBoard(slug: string): Promise<{ ref: AtsRef; jobs: JobPosting[] } | null> {
  const providers: AtsProvider[] = ["ashby", "greenhouse", "lever"];
  for (const provider of providers) {
    try {
      const jobs = await fetchBoard({ provider, slug });
      if (jobs.length > 0) return { ref: { provider, slug }, jobs };
    } catch {
      // try next provider
    }
  }
  return null;
}

export { fetchAshby, fetchGreenhouse, fetchLever };
