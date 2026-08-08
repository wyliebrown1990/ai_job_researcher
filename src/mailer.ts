// Email sender via the Resend HTTP API. Uses ONLY this project's own credentials
// (RESEND_API_KEY + AJR_EMAIL_FROM in this repo's .env). Never borrows another
// project's resources. If unconfigured, sending is a graceful no-op so the daily run
// still produces the committed digest file.
//
// Transient failures (network errors, Resend 5xx/429) are retried with exponential
// backoff — we observed a real transient 502 in the wild. Permanent failures (4xx:
// bad key, unverified sender) are not retried, since a retry can't fix them.

import { config } from "./config.ts";
import { markdownToHtml } from "./lib/markdownToHtml.ts";
import { retrying, type RetryOpts } from "./lib/retry.ts";

export interface SendResult {
  sent: boolean;
  reason?: string;
}

interface Attempt {
  sent: boolean;
  /** Whether the failure is worth retrying (transient). */
  retryable: boolean;
  reason?: string;
}

/** HTTP statuses worth retrying: rate limit + any server-side error. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export function emailConfigured(): boolean {
  return Boolean(config.email.resendApiKey && config.email.from && config.email.to);
}

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

async function attemptSend(html: string, markdown: string, subject: string, doFetch: FetchFn): Promise<Attempt> {
  try {
    const res = await doFetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.email.resendApiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: config.email.from,
        to: [config.email.to],
        subject,
        html,
        text: markdown,
      }),
    });
    if (res.ok) return { sent: true, retryable: false };
    const detail = await res.text().catch(() => "");
    return { sent: false, retryable: isRetryableStatus(res.status), reason: `Resend HTTP ${res.status}: ${detail.slice(0, 160)}` };
  } catch (e) {
    // Network/DNS/connection error before a response — transient, retry.
    return { sent: false, retryable: true, reason: `send failed: ${(e as Error).message}` };
  }
}

export interface SendOpts extends RetryOpts {
  fetchFn?: FetchFn;
}

export async function sendDigestEmail(markdown: string, subject: string, opts: SendOpts = {}): Promise<SendResult> {
  if (!config.email.resendApiKey) return { sent: false, reason: "RESEND_API_KEY not set" };
  if (!config.email.from) return { sent: false, reason: "AJR_EMAIL_FROM not set" };
  if (!config.email.to) return { sent: false, reason: "no recipient" };

  const html = markdownToHtml(markdown);
  const doFetch = opts.fetchFn ?? ((url, init) => fetch(url, init));

  const result = await retrying(
    () => attemptSend(html, markdown, subject, doFetch),
    (r) => !r.sent && r.retryable,
    { attempts: opts.attempts ?? 3, delayMs: opts.delayMs ?? 2000, factor: opts.factor, sleep: opts.sleep },
  );

  if (result.sent) return { sent: true };
  const suffix = result.retryable ? ` (transient, retried)` : "";
  return { sent: false, reason: `${result.reason ?? "unknown error"}${suffix}` };
}
