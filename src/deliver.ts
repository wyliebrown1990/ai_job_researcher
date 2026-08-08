// PERSIST & DELIVER (design N10). Writes the digest to disk (the committed record)
// and returns the path. Email delivery is the last-mile TODO — the chosen channel —
// wired here once the SES/provider sub-decision is made.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface DeliveryReceipt {
  path: string;
  emailed: boolean;
}

export function writeDigest(markdown: string, runDate: string, dir = "digests"): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `digest-${runDate}.md`);
  writeFileSync(path, markdown, "utf8");
  // Also refresh a stable "latest" pointer for convenience.
  writeFileSync(join(dir, "latest.md"), markdown, "utf8");
  return path;
}

/** Email delivery placeholder (design: email is the delivery channel). */
export async function emailDigest(_markdown: string, _runDate: string): Promise<boolean> {
  // TODO: wire SES (noreply@getamicai.com) or a project-scoped transactional sender.
  // Left unimplemented on purpose — sending is gated on the email-path sub-decision.
  return false;
}

export async function deliver(markdown: string, runDate: string): Promise<DeliveryReceipt> {
  const path = writeDigest(markdown, runDate);
  const emailed = await emailDigest(markdown, runDate);
  return { path, emailed };
}
