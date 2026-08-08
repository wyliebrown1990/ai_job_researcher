// Generic result-based retry with exponential backoff. The operation returns a
// result object; `shouldRetry` inspects it to decide whether to try again. Backoff
// delay is injectable so tests run instantly.

export interface RetryOpts {
  /** Total attempts (including the first). Default 3. */
  attempts?: number;
  /** Base delay in ms before the first retry. Default 2000. */
  delayMs?: number;
  /** Backoff multiplier. Default 2 (→ 2s, 4s, …). */
  factor?: number;
  /** Sleep implementation (injectable for tests). */
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function retrying<T>(
  fn: (attempt: number) => Promise<T>,
  shouldRetry: (result: T) => boolean,
  opts: RetryOpts = {},
): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const base = opts.delayMs ?? 2000;
  const factor = opts.factor ?? 2;
  const sleep = opts.sleep ?? realSleep;

  let result = await fn(1);
  for (let attempt = 1; attempt < attempts && shouldRetry(result); attempt++) {
    await sleep(base * factor ** (attempt - 1));
    result = await fn(attempt + 1);
  }
  return result;
}
