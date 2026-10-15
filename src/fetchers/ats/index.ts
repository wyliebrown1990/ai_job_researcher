// Unified ATS interface. Postings churn fast (E3) — every fetch stamps retrievedAt
// and counts are taken from the ATS JSON, never from aggregators (E1).

import type { AtsProvider, JobPosting } from "../../types.ts";
import { fetchAshby } from "./ashby.ts";
import { fetchGreenhouse } from "./greenhouse.ts";
import { fetchLever } from "./lever.ts";
import { fetchRippling } from "./rippling.ts";
import { fetchWorkable } from "./workable.ts";

export interface AtsRef {
  provider: AtsProvider;
  slug: string;
}

export async function fetchBoard(ref: AtsRef): Promise<JobPosting[]> {
  switch (ref.provider) {
    case "ashby": return fetchAshby(ref.slug);
    case "greenhouse": return fetchGreenhouse(ref.slug);
    case "lever": return fetchLever(ref.slug);
    case "workable": return fetchWorkable(ref.slug);
    case "rippling": return fetchRippling(ref.slug);
    default: throw new Error(`unknown ATS provider: ${ref.provider}`);
  }
}

/** Try each provider with the given slug; return the first that yields postings.
 *  A slug guess can hit another company's board, so callers must verify the match
 *  (see resolve/careers.ts) — prefer a board linked from the company's own site. */
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

export { fetchAshby, fetchGreenhouse, fetchLever, fetchRippling, fetchWorkable };
