// PERSIST & DELIVER (design N10). Writes the digest to disk (the committed record)
// and emails it via this project's own Resend credentials (never another project's).

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sendDigestEmail, emailConfigured } from "./mailer.ts";
import { config } from "./config.ts";

export interface DeliveryReceipt {
  path: string;
  emailed: boolean;
  emailReason?: string;
}

export function writeDigest(markdown: string, runDate: string, dir = "digests"): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `digest-${runDate}.md`);
  writeFileSync(path, markdown, "utf8");
  // Also refresh a stable "latest" pointer for convenience.
  writeFileSync(join(dir, "latest.md"), markdown, "utf8");
  return path;
}

export async function deliver(
  markdown: string,
  runDate: string,
  opts: { subject?: string } = {},
): Promise<DeliveryReceipt> {
  const path = writeDigest(markdown, runDate);

  if (!emailConfigured()) {
    return { path, emailed: false, emailReason: "email not configured (see .env.example)" };
  }
  const subject = opts.subject ?? `AI Industry Digest — ${runDate}`;
  const result = await sendDigestEmail(markdown, subject);
  if (result.sent) {
    console.log(`   📧 emailed digest to ${config.email.to}`);
  } else {
    console.log(`   ⚠ email not sent: ${result.reason}`);
  }
  return { path, emailed: result.sent, emailReason: result.reason };
}
