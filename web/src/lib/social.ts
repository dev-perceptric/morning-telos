// Connecting a workspace's social accounts through its brand in Capybaroar (plan: Customer journey, step 4).
// Two pieces, both pure so tests pass fakes:
//   connectLink: an editor asks for Capybaroar's one-time connect page for the workspace's brand.
//   handleSocialWebhook: Capybaroar tells us a channel was connected or lost (Standard Webhooks), and we save it.
// The routes (src/app/api/social/connect-link, src/app/api/partner/capybaroar/webhook) wire in Supabase and the partner.

import type { Partner } from "./partner.ts";
import type { ServiceStatus } from "./provision.ts";
import type { ChannelStatus } from "./socialChannels.ts";
import { verifyWebhook } from "./standardWebhooks.ts";
import { NEEDS } from "./workspace.ts";
import type { Gate, Result } from "./workspaceRoutes.ts";

const fail = (error: string, status: number): Result => ({ status, body: { error } });

// ─────────────── the connect link ───────────────

/** What the person sees when the link can't be made. Plain words, never a raw partner error. */
export const CONNECT_MESSAGES = {
  pending: "We're still setting up social posting for your workspace. Try again in a minute.",
  failed: "Social setup hit a problem. Our team has been told and is fixing it. Try again later.",
  off: "Social accounts are turned off for this workspace.",
  notOpen: "Connecting social accounts isn't open yet. Our team has been told.",
  busy: "The connect page didn't answer. Try again in a minute.",
  broken: "We couldn't make a connect link. Our team has been told. Try again later.",
} as const;

export type ConnectDeps = {
  gate: Gate;
  /** The workspace's Capybaroar row in services, or null. Read with the server's key: services is server only. */
  service: () => Promise<{ status: ServiceStatus; brand_id: string | null } | null>;
  /** partnerFor("capybaroar", env, fetch) from partner.ts. */
  partner: () => { ok: true; partner: Partner } | { ok: false; error: string };
  /** A line for staff (server log, Sentry). Never shown to the customer. */
  log: (message: string) => void;
};

/** Editors and up get a fresh one-time link to Capybaroar's sign-in page for their workspace's brand. */
export async function connectLink(d: ConnectDeps): Promise<Result> {
  const who = await d.gate(NEEDS.connectSocial);
  if (!who.ok) return fail(who.error, who.status);
  const svc = await d.service();
  if (!svc || svc.status === "pending") return fail(CONNECT_MESSAGES.pending, 409);
  if (svc.status === "removing" || svc.status === "removed") return fail(CONNECT_MESSAGES.off, 409);
  if (svc.status !== "ready" || !svc.brand_id) return fail(CONNECT_MESSAGES.failed, 409);
  const p = d.partner();
  if (!p.ok) {
    d.log(`Connect link: ${p.error}`);
    return fail(CONNECT_MESSAGES.notOpen, 503);
  }
  const r = await p.partner.connectLink(svc.brand_id);
  if (!r.ok) {
    d.log(`Connect link for Capybaroar brand ${svc.brand_id} failed: ${r.status} ${r.code} ${r.message}`);
    return r.retryable ? fail(CONNECT_MESSAGES.busy, 503) : fail(CONNECT_MESSAGES.broken, 502);
  }
  return { status: 200, body: { url: r.data.url, expires_at: r.data.expires_at } };
}

// ─────────────── the channel webhook ───────────────

export const CHANNEL_EVENTS = { "channel.connected": "connected", "channel.lost": "lost" } as const satisfies Record<string, ChannelStatus>;
type ChannelEventType = keyof typeof CHANNEL_EVENTS;

export type ChannelEvent = {
  type: ChannelEventType;
  brand_id: string;
  /** The Morning Telos workspace id the brand was made for. */
  external_id: string;
  channel: { id: string; network: string; name: string };
  /** When Capybaroar made the event, so a late retry never undoes a newer one. */
  at: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() && v.trim().length <= max ? v.trim() : null);

/**
 * Reads a delivery's body. Capybaroar sends the Standard Webhooks shape { type, timestamp, data }; a flat body with the
 * same fields also works. Another event type is skipped. `sentAt` is the webhook-timestamp header, in seconds.
 */
export function readChannelEvent(body: string, sentAt: number): { ok: true; event: ChannelEvent } | { ok: false; skip: string } | { ok: false; error: string } {
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(body);
  } catch {
    return { ok: false, error: "Bad body." };
  }
  if (!o || typeof o !== "object" || Array.isArray(o)) return { ok: false, error: "Bad body." };
  const type = typeof o.type === "string" ? o.type : "";
  if (!Object.hasOwn(CHANNEL_EVENTS, type)) return { ok: false, skip: type || "unknown" };
  const data = (o.data && typeof o.data === "object" ? o.data : o) as Record<string, unknown>;
  const ch = (data.channel && typeof data.channel === "object" ? data.channel : {}) as Record<string, unknown>;
  const brand_id = text(data.brand_id, 200);
  const external_id = text(data.external_id, 64);
  const id = text(ch.id, 200);
  const network = text(ch.network, 40)?.toLowerCase() ?? null;
  if (!brand_id || !external_id || !id || !network || !/^[a-z0-9_-]+$/.test(network)) return { ok: false, error: "Bad body." };
  const name = typeof ch.name === "string" ? ch.name.trim().slice(0, 200) : "";
  const stamped = typeof o.timestamp === "string" ? Date.parse(o.timestamp) : NaN;
  const at = new Date(Number.isFinite(stamped) ? stamped : sentAt * 1000).toISOString();
  return { ok: true, event: { type: type as ChannelEventType, brand_id, external_id, channel: { id, network, name }, at } };
}

export type ChannelRow = { workspace_id: string; channel_id: string; network: string; name: string; status: ChannelStatus; updated_at: string };

export type WebhookDeps = {
  /** CAPYBAROAR_WEBHOOK_SECRET, like whsec_... */
  secret: string | undefined;
  /** Now, in seconds. */
  now?: number;
  /** The Capybaroar brand id saved for this workspace in services, or null when it has none. */
  brandOf: (workspaceId: string) => Promise<string | null>;
  /** Marks a delivery id as handled. False when it was handled before. */
  markSeen: (id: string, type: string) => Promise<boolean>;
  /** Takes the mark off again when saving failed, so Capybaroar's retry runs. */
  unmark: (id: string) => Promise<void>;
  /** Saves the channel. False when a newer event was already saved. */
  save: (row: ChannelRow) => Promise<boolean>;
  log: (message: string) => void;
};

export async function handleSocialWebhook(req: { headers: Headers; body: string }, d: WebhookDeps): Promise<Result> {
  if (!d.secret?.trim()) {
    d.log("Capybaroar webhook: CAPYBAROAR_WEBHOOK_SECRET is not set on the server.");
    return fail("The webhook secret is not set on the server.", 500);
  }
  const now = d.now ?? Date.now() / 1000;
  if (!verifyWebhook(req.headers, req.body, d.secret, now)) return fail("Bad or missing signature.", 401);
  const id = req.headers.get("webhook-id")!;
  if (id.length > 200) return fail("Bad webhook id.", 400);
  const read = readChannelEvent(req.body, Number(req.headers.get("webhook-timestamp")));
  if (!read.ok) return "skip" in read ? { status: 200, body: { received: true, skipped: read.skip } } : fail(read.error, 400);
  const e = read.event;

  // The brand must be the one we saved for that workspace. Anything else is refused and nothing is written.
  const saved = UUID.test(e.external_id) ? await d.brandOf(e.external_id) : null;
  if (!saved || saved !== e.brand_id) {
    d.log(`Capybaroar webhook ${id}: brand ${e.brand_id} is not workspace ${e.external_id}'s brand. Refused.`);
    return fail("This brand does not belong to that workspace.", 403);
  }

  if (!(await d.markSeen(id, e.type))) return { status: 200, body: { received: true, duplicate: true } };
  try {
    const changed = await d.save({ workspace_id: e.external_id, channel_id: e.channel.id, network: e.channel.network, name: e.channel.name, status: CHANNEL_EVENTS[e.type], updated_at: e.at });
    return { status: 200, body: { received: true, changed } };
  } catch (err) {
    await d.unmark(id).catch(() => {});
    const message = err instanceof Error ? err.message : String(err);
    d.log(`Capybaroar webhook ${id} could not be saved: ${message}`);
    return fail("Could not save the channel. Send it again.", 500);
  }
}
