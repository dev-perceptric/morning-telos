// Sends email through Resend's HTTP API (copied from Arrowsterr's src/lib/email.ts). The caller passes the key,
// the sender and fetch, so tests can pass fakes and nothing here reads the environment.
import type { Email } from "./emailKit.ts";

export const DEFAULT_FROM = "Morning Telos <meet@morningtelos.com>";
export const RESEND_URL = "https://api.resend.com/emails";

export type ResendDeps = { key: string; from: string; fetch: typeof fetch };

/** More for one email: who replies go to, and a key so a retry never sends twice. */
export type EmailExtra = { replyTo?: string | null; idempotencyKey?: string };

/** Send an email built with the kit (./emailKit.ts): its HTML and its plain-text copy. Throws when Resend says no. */
export async function sendBuilt(to: string[], mail: Email, d: ResendDeps, extra: EmailExtra = {}): Promise<boolean> {
  if (!d.key || !to.length) return false;
  const res = await d.fetch(RESEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${d.key}`,
      "Content-Type": "application/json",
      ...(extra.idempotencyKey ? { "Idempotency-Key": extra.idempotencyKey.slice(0, 256) } : {}),
    },
    body: JSON.stringify({
      from: d.from || DEFAULT_FROM,
      to,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      ...(extra.replyTo ? { reply_to: extra.replyTo } : {}),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Resend returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return true;
}
