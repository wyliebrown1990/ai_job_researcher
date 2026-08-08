import { expect, test, describe } from "bun:test";
import { retrying } from "../src/lib/retry.ts";
import { isRetryableStatus } from "../src/mailer.ts";

const noSleep = async () => {};

describe("retrying", () => {
  test("returns immediately on first success (no retry)", async () => {
    let calls = 0;
    const r = await retrying(async () => { calls++; return { ok: true }; }, (x) => !x.ok, { sleep: noSleep });
    expect(calls).toBe(1);
    expect(r.ok).toBe(true);
  });

  test("retries transient failures then succeeds", async () => {
    let calls = 0;
    const r = await retrying(
      async () => { calls++; return { ok: calls >= 3 }; }, // fail twice, then succeed
      (x) => !x.ok,
      { attempts: 3, sleep: noSleep },
    );
    expect(calls).toBe(3);
    expect(r.ok).toBe(true);
  });

  test("does not retry when shouldRetry is false", async () => {
    let calls = 0;
    const r = await retrying(async () => { calls++; return { ok: false, permanent: true }; }, (x) => !x.ok && !x.permanent, { sleep: noSleep });
    expect(calls).toBe(1);
    expect(r.ok).toBe(false);
  });

  test("stops after `attempts` and returns the last failure", async () => {
    let calls = 0;
    const r = await retrying(async () => { calls++; return { ok: false }; }, (x) => !x.ok, { attempts: 3, sleep: noSleep });
    expect(calls).toBe(3);
    expect(r.ok).toBe(false);
  });

  test("applies exponential backoff delays", async () => {
    const delays: number[] = [];
    let calls = 0;
    await retrying(async () => { calls++; return { ok: false }; }, (x) => !x.ok,
      { attempts: 3, delayMs: 100, factor: 2, sleep: async (ms) => { delays.push(ms); } });
    expect(delays).toEqual([100, 200]); // 2 retries → base, base*2
  });
});

describe("isRetryableStatus", () => {
  test("429 and 5xx are retryable; 4xx are not", () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(502)).toBe(true);
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(401)).toBe(false);
    expect(isRetryableStatus(403)).toBe(false);
  });
});
