import { describe, expect, test } from "bun:test";
import { selectDailyWatchlist } from "../src/pipeline.ts";
import { config } from "../src/config.ts";
import type { Company } from "../src/types.ts";

function company(domain: string, pinned = false): Company {
  return {
    domain, displayName: domain, aliases: [domain], status: "watching", roleWatches: [],
    evidence: [], firstSeen: "2026-08-01T00:00:00Z", lastUpdated: "2026-08-01T00:00:00Z",
    sightings: 1, pinned,
  };
}

describe("daily refresh plan", () => {
  test("prioritizes followed companies within the existing daily fetch cap", () => {
    const passive = Array.from({ length: config.limits.maxRefreshPerDay }, (_, index) => company(`passive-${index}.ai`));
    const archived = company("archived.ai", true);
    archived.status = "archived";
    const selected = selectDailyWatchlist([...passive, company("followed.ai", true), archived]);

    expect(selected).toHaveLength(config.limits.maxRefreshPerDay);
    expect(selected[0]?.domain).toBe("followed.ai");
    expect(selected.map((item) => item.domain)).not.toContain("archived.ai");
  });
});
