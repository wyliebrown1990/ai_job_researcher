// Email sender via the Resend HTTP API. Uses ONLY this project's own credentials
// (RESEND_API_KEY + AJR_EMAIL_FROM in this repo's .env). Never borrows another
// project's resources. If unconfigured, sending is a graceful no-op so the daily run
// still produces the committed digest file.

import { config } from "./config.ts";
import { markdownToHtml } from "./lib/markdownToHtml.ts";

export interface SendResult {
  sent: boolean;
  reason?: string;
}

export function emailConfigured(): boolean {
  return Boolean(config.email.resendApiKey && config.email.from && config.email.to);
}

export async function sendDigestEmail(markdown: string, subject: string): Promise<SendResult> {
  if (!config.email.resendApiKey) return { sent: false, reason: "RESEND_API_KEY not set" };
  if (!config.email.from) return { sent: false, reason: "AJR_EMAIL_FROM not set" };
  if (!config.email.to) return { sent: false, reason: "no recipient" };

  const html = markdownToHtml(markdown);
  try {
    const res = await fetch("https://api.resend.com/emails", {
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
        text: markdown, // plaintext fallback
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { sent: false, reason: `Resend HTTP ${res.status}: ${detail.slice(0, 200)}` };
    }
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: `send failed: ${(e as Error).message}` };
  }
}
