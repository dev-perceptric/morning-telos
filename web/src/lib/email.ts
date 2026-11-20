// Sends email through Resend's HTTP API (copied from Arrowsterr's src/lib/email.ts). The caller passes the key,
// the sender and fetch, so tests can pass fakes and nothing here reads the environment.
import type { Email } from "./emailKit.ts";

export const DEFAULT_FROM = "Morning Telos <meet@morningtelos.com>";
export const RESEND_URL = "https://api.resend.com/emails";

export type ResendDeps = { key: string; from: string; fetch: typeof fetch };

/**
 * More for one email: who replies go to, a key so a retry never sends twice, and extra headers on the email itself
 * (List-Unsubscribe for emails people can turn off).
 */
export type EmailExtra = { replyTo?: string | null; idempotencyKey?: string; headers?: Record<string, string> };

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
      ...(extra.headers && Object.keys(extra.headers).length ? { headers: extra.headers } : {}),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Resend returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return true;
}

// ─────────────── received email (the email door, src/lib/teamEmailInbound.ts) ───────────────

export const RESEND_RECEIVING_URL = "https://api.resend.com/emails/receiving";

/** The parts of a received email we read. Resend's GET /emails/receiving/{id}. */
export type ReceivedEmail = {
  id: string;
  from: string;
  to: string[];
  cc: string[];
  received_for: string[];
  subject: string;
  text: string | null;
  html: string | null;
  headers: Record<string, unknown>;
  message_id: string | null;
  authentication: { spf?: string | null; dkim?: string | null; dmarc?: string | null } | null;
  attachments: { id: string; filename: string; content_type: string; size?: number }[];
};

const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** Reads one received email: its text, HTML, headers and attachment names. Throws when Resend says no. */
export async function getReceivedEmail(id: string, d: Pick<ResendDeps, "key" | "fetch">): Promise<ReceivedEmail> {
  if (!d.key) throw new Error("RESEND_API_KEY is not set.");
  if (!/^[A-Za-z0-9-]{1,100}$/.test(id)) throw new Error("That is not a Resend email id.");
  const res = await d.fetch(`${RESEND_RECEIVING_URL}/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${d.key}` }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Resend returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const e = (await res.json()) as Record<string, unknown>;
  const auth = e.authentication && typeof e.authentication === "object" ? (e.authentication as ReceivedEmail["authentication"]) : null;
  return {
    id: String(e.id ?? id),
    from: String(e.from ?? ""),
    to: strs(e.to),
    cc: strs(e.cc),
    received_for: strs(e.received_for),
    subject: typeof e.subject === "string" ? e.subject : "",
    text: typeof e.text === "string" ? e.text : null,
    html: typeof e.html === "string" ? e.html : null,
    headers: e.headers && typeof e.headers === "object" && !Array.isArray(e.headers) ? (e.headers as Record<string, unknown>) : {},
    message_id: typeof e.message_id === "string" ? e.message_id : null,
    authentication: auth,
    attachments: (Array.isArray(e.attachments) ? e.attachments : [])
      .filter((a): a is Record<string, unknown> => Boolean(a) && typeof a === "object")
      .map((a) => ({ id: String(a.id ?? ""), filename: String(a.filename ?? "file"), content_type: String(a.content_type ?? ""), size: typeof a.size === "number" ? a.size : undefined })),
  };
}

/** A received email's attachment with a link to download it (Resend's link lasts an hour). */
export type ReceivedAttachment = { id: string; filename: string; content_type: string; content_disposition: string | null; size: number; download_url: string };

/** Lists a received email's attachments with their download links. Throws when Resend says no. */
export async function listReceivedAttachments(id: string, d: Pick<ResendDeps, "key" | "fetch">): Promise<ReceivedAttachment[]> {
  if (!d.key) throw new Error("RESEND_API_KEY is not set.");
  if (!/^[A-Za-z0-9-]{1,100}$/.test(id)) throw new Error("That is not a Resend email id.");
  const res = await d.fetch(`${RESEND_RECEIVING_URL}/${encodeURIComponent(id)}/attachments?limit=100`, { headers: { Authorization: `Bearer ${d.key}` }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Resend returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { data?: unknown };
  return (Array.isArray(body.data) ? body.data : [])
    .filter((a): a is Record<string, unknown> => Boolean(a) && typeof a === "object")
    .map((a) => ({
      id: String(a.id ?? ""),
      filename: String(a.filename ?? "file"),
      content_type: String(a.content_type ?? ""),
      content_disposition: typeof a.content_disposition === "string" ? a.content_disposition : null,
      size: Number(a.size) || 0,
      download_url: String(a.download_url ?? ""),
    }));
}
