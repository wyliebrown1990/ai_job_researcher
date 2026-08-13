import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { deliver } from "../src/deliver.ts";

describe("deliver", () => {
  test("persists a digest while an explicit no-email run skips delivery", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ajr-deliver-"));
    try {
      const receipt = await deliver("# Test digest", "2026-08-13", { skipEmail: true, dir });
      expect(receipt).toMatchObject({ emailed: false, emailReason: "email disabled for this run" });
      expect(readFileSync(join(dir, "digest-2026-08-13.md"), "utf8")).toBe("# Test digest");
      expect(readFileSync(join(dir, "latest.md"), "utf8")).toBe("# Test digest");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
