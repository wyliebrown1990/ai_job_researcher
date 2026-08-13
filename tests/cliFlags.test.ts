import { describe, expect, test } from "bun:test";
import { parseFlags } from "../src/lib/cliFlags.ts";

describe("parseFlags", () => {
  test("keeps adjacent boolean flags independent", () => {
    expect(parseFlags(["--force", "--no-email"])).toEqual({
      positional: [], flags: { force: "true", "no-email": "true" },
    });
  });

  test("keeps a value attached to its flag", () => {
    expect(parseFlags(["jobs", "happyrobot", "--provider", "ashby"])).toEqual({
      positional: ["jobs", "happyrobot"], flags: { provider: "ashby" },
    });
  });
});
