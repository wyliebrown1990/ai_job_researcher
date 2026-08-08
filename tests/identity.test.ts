import { expect, test, describe } from "bun:test";
import { normalizeDomain, registrableDomain, companyKey, mergeAliases, sameCompany } from "../src/lib/identity.ts";

describe("normalizeDomain", () => {
  test("strips protocol, path, www", () => {
    expect(normalizeDomain("https://www.HappyRobot.ai/careers")).toBe("happyrobot.ai");
    expect(normalizeDomain("HappyRobot.ai")).toBe("happyrobot.ai");
  });
  test("rejects non-domains", () => {
    expect(normalizeDomain("HappyRobot")).toBeNull();
    expect(normalizeDomain("")).toBeNull();
    expect(normalizeDomain(null)).toBeNull();
  });
});

describe("registrableDomain (E4)", () => {
  test("drops common ATS subdomains", () => {
    expect(registrableDomain("jobs.happyrobot.ai")).toBe("happyrobot.ai");
    expect(registrableDomain("careers.acme.com")).toBe("acme.com");
    expect(registrableDomain("acme.com")).toBe("acme.com");
  });
});

describe("dedup (E4)", () => {
  test("name variants collapse to one key via domain", () => {
    const key = companyKey("https://happyrobot.ai");
    expect(companyKey("jobs.ashbyhq.com")).not.toBe(key); // different domain, not merged
    expect(companyKey("HappyRobot.ai")).toBe(key);
  });
  test("sameCompany: domain match => same; no domain => unknown", () => {
    expect(sameCompany({ domain: "happyrobot.ai" }, { domain: "www.happyrobot.ai" })).toBe("same");
    expect(sameCompany({ domain: "happyrobot.ai" }, { domain: "june.ai" })).toBe("different");
    expect(sameCompany({ domain: null }, { domain: "june.ai" })).toBe("unknown");
  });
  test("mergeAliases dedupes case-insensitively", () => {
    expect(mergeAliases(["HappyRobot"], ["happyrobot", "Happyrobot Inc."]))
      .toEqual(["HappyRobot", "Happyrobot Inc."]);
  });
});
