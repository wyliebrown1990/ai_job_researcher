import { describe, expect, test } from "bun:test";
import { canonicalLocationLabel, matchesSelectedLocation, searchLocations } from "../src/lib/locations.ts";

describe("local city search", () => {
  test("returns a canonical, disambiguated selection without calling an external API", () => {
    expect(searchLocations("san francisco")).toContainEqual(expect.objectContaining({
      label: "San Francisco, CA, United States",
      countryCode: "US",
    }));
  });

  test("uses a typed country qualifier to disambiguate duplicate city names", () => {
    expect(searchLocations("London, UK")[0]).toMatchObject({
      label: "London, ENG, United Kingdom",
    });
  });

  test("requires the full canonical label and matches common ATS variants", () => {
    const selected = "New York City, NY, United States";
    expect(canonicalLocationLabel(selected)).toBe(selected);
    expect(canonicalLocationLabel("New York City")).toBeNull();
    expect(matchesSelectedLocation("New York, NY", selected)).toBe(true);
    expect(matchesSelectedLocation("London, Ontario, Canada", selected)).toBe(false);
  });
});
