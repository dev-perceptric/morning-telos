// Connecting social networks (Capybaroar) and SEO tools (Arrowsterr) on Morning Telos's own pages. The customer picks
// a network on our screen, signs in on that network's own page, and comes back to our return page
// (/settings/social/return). They never see Capybaroar's or Arrowsterr's own connect page.
//
//   start:  POST /api/social/connect/start { workspaceId, network, from } -> { mode, url }
//           The partner starts the network's sign-in and sends the browser back to our return_url. The return_url
//           carries a sealed note of ours (the state): which product, workspace, person, network, where they started
//           and until when. Only this server can open it, so the way back can't be pointed at another workspace.
//   return: POST /api/connect/return { state, query } -> { workspaceId, view }
//           Reads ?cb_status (Capybaroar) or ?aw_status (Arrowsterr): connected, error, or pick (choose pages).
//   pick:   GET and POST /api/social/connect/pick/:token proxy the partner's pick step, after the same checks.
//
// When Capybaroar answers 404 for the new calls (an older Capybaroar), connectMode() says "link" and start falls back
// to the one-time connect link (social.ts), so Morning Telos keeps working whichever deploys first.
// Everything here is pure: the routes pass the gate, the database reads, the partner and the keys.

import { CONNECT_ID, PICK_TOKEN, type Connectable, type IntegrationConnect, type Partner, type Product, type SocialConnect } from "./partner.ts";
import { cleanOrigin, connectMode, missingRoute, originPath, RETURN_PATH, type ConnectOrigin, type ReturnView } from "./connectFlow.ts";
import type { ServiceStatus } from "./provision.ts";
import { openWith, sealWith, type Keyring } from "./sealing.ts";
import { CONNECT_MESSAGES } from "./social.ts";
import { NETWORK_LOGOS, networkName, sameNetwork } from "./socialChannels.ts";
import { NEEDS } from "./workspace.ts";
import type { Gate, Result } from "./workspaceRoutes.ts";

const fail = (error: string, status: number): Result => ({ status, body: { error } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export { cleanOrigin, connectMode, missingRoute, openIn, originPath, RETURN_PATH, startRequest, type ConnectOrigin, type ReturnView } from "./connectFlow.ts";

/** What the person sees when something here goes wrong. Plain words, never a partner's name or raw error. */
export const RETURN_MESSAGES = {
  expired: "This sign-in ran out or isn't valid anymore. Start again.",
  someoneElse: "Someone else started this sign-in. Start again yourself.",
  wrongWorkspace: "This sign-in is for another workspace.",
  pickNetwork: "Pick a network from the list.",
  pickSome: "Pick at least one page or account.",
  pickGone: "These choices ran out. Start again.",
  mismatch: "These choices don't match the sign-in you started. Start again.",
  toolsNotOpen: "Connecting SEO tools isn't open yet.",
  pickLimit: "Your plan has no room for that many accounts. Pick fewer, or upgrade.",
  pickTaken: "One of those accounts is already connected to another workspace. Pick others.",
} as const;

// ─────────────── the sealed state ───────────────

/** A sign-in may take this long before the way back stops working. */
export const STATE_TTL_MS = 30 * 60_000;
const STATE_AAD = "partner-connect";
const PRODUCTS: readonly Product[] = ["capybaroar", "arrowsterr"];

export type ConnectState = { product: Product; ws: string; user: string; item: string; from: ConnectOrigin; exp: number };

/** The sealed note the return page reads. */
export function signConnectState(ring: Keyring, s: Omit<ConnectState, "exp">, now = Date.now()): string {
  return sealWith(ring, JSON.stringify({ ...s, exp: now + STATE_TTL_MS }), STATE_AAD);
}

/** The note, when this server sealed it, every part makes sense and it hasn't run out. Null for anything else. */
export function readConnectState(ring: Keyring, sealed: unknown, now = Date.now()): ConnectState | null {
  if (typeof sealed !== "string" || !sealed || sealed.length > 2000) return null;
  try {
    const s = JSON.parse(openWith(ring, sealed, STATE_AAD)) as Partial<ConnectState>;
    if (!PRODUCTS.includes(s.product as Product)) return null;
    if (typeof s.ws !== "string" || !UUID.test(s.ws) || typeof s.user !== "string" || !s.user) return null;
    if (typeof s.item !== "string" || !CONNECT_ID.test(s.item) || typeof s.exp !== "number" || s.exp < now) return null;
    return { product: s.product as Product, ws: s.ws, user: s.user, item: s.item, from: cleanOrigin(s.from), exp: s.exp };
  } catch {
    return null;
  }
}

/** Our return page's address with the state on it. The partner adds its own params next to ours. */
export function returnUrl(appOrigin: string, state: string): string {
  return `${appOrigin.replace(/\/+$/, "")}${RETURN_PATH}?${new URLSearchParams({ state })}`;
}

// ─────────────── which flow ───────────────

/** Known networks first, in the logo order, then the rest by name. */
export function sortNetworks(list: readonly Connectable[]): Connectable[] {
  const rank = (id: string) => {
    const i = (NETWORK_LOGOS as readonly string[]).indexOf(id);
    return i < 0 ? NETWORK_LOGOS.length : i;
  };
  return [...list].sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name));
}

const TOOL_NAMES: Record<string, string> = {
  cloudflare: "Cloudflare",
  google_search_console: "Google Search Console",
  "google-search-console": "Google Search Console",
  gsc: "Google Search Console",
  google_analytics: "Google Analytics",
  "google-analytics": "Google Analytics",
  ga4: "Google Analytics",
  wordpress: "WordPress",
};

/** The name people know: "LinkedIn" for a network, "Google Search Console" for a tool. */
export function itemName(product: Product, id: string): string {
  if (product === "arrowsterr") return TOOL_NAMES[id] ?? networkName(id);
  return networkName(id);
}

// ─────────────── the return page ───────────────

const STATUS_KEY: Record<Product, { status: string; item: string; other: string }> = {
  capybaroar: { status: "cb_status", item: "network", other: "aw_status" },
  arrowsterr: { status: "aw_status", item: "integration", other: "cb_status" },
};

/**
 * The plain line for an error code the partner sent back. Capybaroar: cancelled, failed, expired, used, no_accounts,
 * taken, plan_limit. Arrowsterr: expired, used, denied, not_connected, brand_gone, provider_error.
 */
export function errorText(name: string, reason: string): string {
  switch (reason.toLowerCase()) {
    case "cancelled":
    case "canceled":
    case "denied":
    case "access_denied":
      return `You stopped before ${name} finished connecting. Try again and allow access.`;
    case "expired":
      return `The ${name} sign-in took too long. Try again.`;
    case "used":
      return `This ${name} sign-in was already used. Try again to start a new one.`;
    case "no_accounts":
      return `We didn't find a ${name} page or account you can post to. Check that you manage one, then try again.`;
    case "taken":
      return `That ${name} account is already connected to another workspace.`;
    case "plan_limit":
      return "Your plan has no room for more accounts. Remove one or upgrade, then try again.";
    case "not_connected":
      return `${name} didn't finish connecting. Try again.`;
    case "brand_gone":
      return "Your workspace isn't set up for this right now. Our team has been told.";
    case "provider_error":
      return `${name} had a problem on its side. Try again in a few minutes.`;
    default:
      return `${name} didn't connect. Try again.`;
  }
}

/** The connected view, for the return page and after a pick. */
export function connectedView(s: ConnectState): Extract<ReturnView, { kind: "connected" }> {
  const name = itemName(s.product, s.item);
  return { kind: "connected", product: s.product, item: s.item, name, title: `${name} connected`, back: originPath(s.from, s.product), chat: s.from.to === "chat", from: s.from };
}

/** What the return page shows, from our checked state and the params the partner added. */
export function returnView(s: ConnectState, query: Record<string, string | undefined>): ReturnView {
  const keys = STATUS_KEY[s.product];
  const name = itemName(s.product, s.item);
  const back = originPath(s.from, s.product);
  const error = (text: string): ReturnView => ({ kind: "error", product: s.product, item: s.item, name, text, back, from: s.from, retry: true });
  const status = (query[keys.status] ?? "").trim().toLowerCase();
  // The network in the address must be the one we sealed: anyone can change an address.
  const named = (query[keys.item] ?? "").trim().toLowerCase();
  if (named && !sameNetwork(named, s.item)) return error(RETURN_MESSAGES.mismatch);
  if (status === "connected") return connectedView(s);
  if (status === "pick") {
    const token = (query.pick ?? "").trim();
    if (s.product !== "capybaroar" || !PICK_TOKEN.test(token)) return error(errorText(name, ""));
    return { kind: "pick", product: s.product, item: s.item, name, token, back, from: s.from };
  }
  if (status === "error") {
    const reason = (query.reason ?? "").trim();
    return error(errorText(name, /^[A-Za-z0-9_.-]{1,60}$/.test(reason) ? reason : ""));
  }
  return error(errorText(name, ""));
}

/** The return address's params as plain strings, only the ones the page reads. */
export function cleanQuery(v: unknown): Record<string, string> {
  const o = (v && typeof v === "object" && !Array.isArray(v) ? v : {}) as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const k of ["cb_status", "aw_status", "network", "integration", "reason", "pick"]) if (typeof o[k] === "string") out[k] = (o[k] as string).slice(0, 300);
  return out;
}

// ─────────────── route handlers ───────────────

export type ServiceRow = { status: ServiceStatus; brand_id: string | null } | null;
type Log = (message: string) => void;
type Maybe<T> = { ok: true; client: T } | { ok: false; error: string };

/** The workspace's brand in the product, or the plain reason it can't be used yet. */
function brandOf(svc: ServiceRow): { ok: true; brand: string } | { ok: false; result: Result } {
  if (!svc || svc.status === "pending") return { ok: false, result: fail(CONNECT_MESSAGES.pending, 409) };
  if (svc.status === "removing" || svc.status === "removed") return { ok: false, result: fail(CONNECT_MESSAGES.off, 409) };
  if (svc.status !== "ready" || !svc.brand_id) return { ok: false, result: fail(CONNECT_MESSAGES.failed, 409) };
  return { ok: true, brand: svc.brand_id };
}

export type ListDeps = { gate: Gate; social: () => Maybe<SocialConnect>; log: Log };

/** GET /api/social/networks: the networks to show, or "link" mode when Capybaroar doesn't list them yet. */
export async function listNetworks(d: ListDeps): Promise<Result> {
  const who = await d.gate(NEEDS.connectSocial);
  if (!who.ok) return fail(who.error, who.status);
  const c = d.social();
  if (!c.ok) {
    d.log(`Networks: ${c.error}`);
    return fail(CONNECT_MESSAGES.notOpen, 503);
  }
  const r = await c.client.networks();
  const mode = connectMode(r);
  if (mode === "link") return { status: 200, body: { mode, networks: [] } };
  if (!r.ok) {
    d.log(`Networks list failed: ${r.status} ${r.code} ${r.message}`);
    return fail(CONNECT_MESSAGES.busy, 503);
  }
  return { status: 200, body: { mode, networks: sortNetworks(r.data) } };
}

export type StartDeps = {
  gate: Gate;
  /** The workspace the gate checks, from the request. */
  workspaceId: string;
  /** The workspace's Capybaroar row in services. */
  service: () => Promise<ServiceRow>;
  social: () => Maybe<SocialConnect>;
  /** partnerFor("capybaroar", ...): only for the old connect link. */
  partner: () => { ok: true; partner: Partner } | { ok: false; error: string };
  ring: () => Keyring;
  /** Where this app is served (APP_URL). */
  appOrigin: string;
  now?: number;
  log: Log;
};

/** POST /api/social/connect/start: the network's own sign-in address, or the old connect page in "link" mode. */
export async function startConnect(input: { network?: unknown; from?: unknown }, d: StartDeps): Promise<Result> {
  const who = await d.gate(NEEDS.connectSocial);
  if (!who.ok) return fail(who.error, who.status);
  const network = typeof input.network === "string" ? input.network.trim().toLowerCase() : input.network == null ? "" : null;
  if (network === null || (network && !CONNECT_ID.test(network))) return fail(RETURN_MESSAGES.pickNetwork, 400);
  const from = cleanOrigin(input.from);
  const b = brandOf(await d.service());
  if (!b.ok) return b.result;
  const c = d.social();
  if (!c.ok) {
    d.log(`Connect start: ${c.error}`);
    return fail(CONNECT_MESSAGES.notOpen, 503);
  }

  const oldLink = async (): Promise<Result> => {
    const p = d.partner();
    if (!p.ok) {
      d.log(`Connect link: ${p.error}`);
      return fail(CONNECT_MESSAGES.notOpen, 503);
    }
    const r = await p.partner.connectLink(b.brand);
    if (!r.ok) {
      d.log(`Connect link for brand ${b.brand} failed: ${r.status} ${r.code} ${r.message}`);
      return r.retryable ? fail(CONNECT_MESSAGES.busy, 503) : fail(CONNECT_MESSAGES.broken, 502);
    }
    return { status: 200, body: { mode: "link", url: r.data.url } };
  };

  const list = await c.client.networks();
  const mode = connectMode(list);
  if (mode === "link") return oldLink();
  if (!list.ok) {
    d.log(`Networks list failed: ${list.status} ${list.code} ${list.message}`);
    return fail(CONNECT_MESSAGES.busy, 503);
  }
  if (!network || !list.data.some((n) => n.id === network)) return fail(RETURN_MESSAGES.pickNetwork, 400);

  const state = signConnectState(d.ring(), { product: "capybaroar", ws: d.workspaceId, user: who.userId, item: network, from }, d.now);
  const r = await c.client.start(b.brand, { network, return_url: returnUrl(d.appOrigin, state) });
  // The partner's own 404 (not_found: no such brand) is a real error. Only a missing route means an older Capybaroar.
  if (!r.ok && missingRoute(r)) return oldLink();
  if (!r.ok) {
    d.log(`Connect start for brand ${b.brand}, ${network} failed: ${r.status} ${r.code} ${r.message}`);
    return r.retryable ? fail(CONNECT_MESSAGES.busy, 503) : fail(CONNECT_MESSAGES.broken, 502);
  }
  return { status: 200, body: { mode: "branded", url: r.data.url } };
}

// SEO tools. There's no screen for these until Arrowsterr lists some: the routes are ready for one.

export type IntegrationDeps = Omit<StartDeps, "social" | "partner"> & { tools: () => Maybe<IntegrationConnect> };

/** GET /api/seo/integrations: the tools to show, or "off" when Arrowsterr doesn't list them yet. */
export async function listIntegrations(d: Pick<IntegrationDeps, "gate" | "tools" | "log">): Promise<Result> {
  const who = await d.gate(NEEDS.connectSocial);
  if (!who.ok) return fail(who.error, who.status);
  const c = d.tools();
  if (!c.ok) return { status: 200, body: { mode: "off", integrations: [] } };
  const r = await c.client.integrations();
  if (connectMode(r) === "link") return { status: 200, body: { mode: "off", integrations: [] } };
  if (!r.ok) {
    d.log(`Integrations list failed: ${r.status} ${r.code} ${r.message}`);
    return fail(CONNECT_MESSAGES.busy, 503);
  }
  return { status: 200, body: { mode: "branded", integrations: [...r.data].sort((a, b) => a.name.localeCompare(b.name)) } };
}

/** POST /api/seo/connect/start: the tool's own sign-in address, coming back to our return page. */
export async function startIntegration(input: { integration?: unknown; from?: unknown }, d: IntegrationDeps): Promise<Result> {
  const who = await d.gate(NEEDS.connectSocial);
  if (!who.ok) return fail(who.error, who.status);
  const integration = typeof input.integration === "string" ? input.integration.trim().toLowerCase() : "";
  if (!CONNECT_ID.test(integration)) return fail("Pick a tool from the list.", 400);
  const b = brandOf(await d.service());
  if (!b.ok) return b.result;
  const c = d.tools();
  if (!c.ok) {
    d.log(`Integration start: ${c.error}`);
    return fail(RETURN_MESSAGES.toolsNotOpen, 503);
  }
  const list = await c.client.integrations();
  if (connectMode(list) === "link") return fail(RETURN_MESSAGES.toolsNotOpen, 503);
  if (!list.ok) return fail(CONNECT_MESSAGES.busy, 503);
  if (!list.data.some((t) => t.id === integration)) return fail("Pick a tool from the list.", 400);
  const state = signConnectState(d.ring(), { product: "arrowsterr", ws: d.workspaceId, user: who.userId, item: integration, from: cleanOrigin(input.from) }, d.now);
  const r = await c.client.start(b.brand, { integration, return_url: returnUrl(d.appOrigin, state) });
  if (!r.ok) {
    d.log(`Integration start for brand ${b.brand}, ${integration} failed: ${r.status} ${r.code} ${r.message}`);
    if (missingRoute(r)) return fail(RETURN_MESSAGES.toolsNotOpen, 503);
    return r.retryable ? fail(CONNECT_MESSAGES.busy, 503) : fail(CONNECT_MESSAGES.broken, 502);
  }
  return { status: 200, body: { mode: "branded", url: r.data.url } };
}

export type VerifyDeps = {
  ring: () => Keyring;
  /** The role check for a workspace (roleGate(request, ws).gate in the routes). */
  gateFor: (workspaceId: string) => Gate;
  now?: number;
};

/** The state, when this server sealed it, it hasn't run out, and the signed-in person is the admin who started it. */
export async function verifyReturn(input: { state?: unknown; workspaceId?: unknown }, d: VerifyDeps): Promise<{ ok: true; state: ConnectState } | { ok: false; result: Result }> {
  const s = readConnectState(d.ring(), input.state, d.now);
  if (!s) return { ok: false, result: fail(RETURN_MESSAGES.expired, 400) };
  if (input.workspaceId != null && input.workspaceId !== "" && input.workspaceId !== s.ws) return { ok: false, result: fail(RETURN_MESSAGES.wrongWorkspace, 403) };
  const who = await d.gateFor(s.ws)(NEEDS.connectSocial);
  if (!who.ok) return { ok: false, result: fail(who.error, who.status) };
  if (who.userId !== s.user) return { ok: false, result: fail(RETURN_MESSAGES.someoneElse, 403) };
  return { ok: true, state: s };
}

/** POST /api/connect/return: what the return page shows. */
export async function connectReturn(input: { state?: unknown; query?: unknown; workspaceId?: unknown }, d: VerifyDeps): Promise<Result> {
  const v = await verifyReturn(input, d);
  if (!v.ok) return v.result;
  return { status: 200, body: { workspaceId: v.state.ws, view: returnView(v.state, cleanQuery(input.query)) } };
}

export type PickDeps = VerifyDeps & { social: () => Maybe<SocialConnect>; log: Log };

/** The partner's pick step for this token, after the state checks, or the reason it can't be shown. */
async function pickFor(token: string, input: { state?: unknown; workspaceId?: unknown }, d: PickDeps) {
  if (!PICK_TOKEN.test(token)) return { ok: false as const, result: fail(RETURN_MESSAGES.pickGone, 400) };
  const v = await verifyReturn(input, d);
  if (!v.ok) return v;
  if (v.state.product !== "capybaroar") return { ok: false as const, result: fail(RETURN_MESSAGES.mismatch, 400) };
  const c = d.social();
  if (!c.ok) {
    d.log(`Pick: ${c.error}`);
    return { ok: false as const, result: fail(CONNECT_MESSAGES.notOpen, 503) };
  }
  const r = await c.client.pick(token);
  if (!r.ok) {
    d.log(`Pick for workspace ${v.state.ws} failed: ${r.status} ${r.code} ${r.message}`);
    if (r.status === 404 || r.status === 410) return { ok: false as const, result: fail(RETURN_MESSAGES.pickGone, 410) };
    return { ok: false as const, result: r.retryable ? fail(CONNECT_MESSAGES.busy, 503) : fail(CONNECT_MESSAGES.broken, 502) };
  }
  if (!sameNetwork(r.data.network, v.state.item)) {
    d.log(`Pick for workspace ${v.state.ws}: the token is for ${r.data.network}, the state for ${v.state.item}. Refused.`);
    return { ok: false as const, result: fail(RETURN_MESSAGES.mismatch, 403) };
  }
  return { ok: true as const, state: v.state, pick: r.data, client: c.client };
}

/** GET /api/social/connect/pick/:token: the pages and accounts to choose from. */
export async function pickOptions(token: string, input: { state?: unknown; workspaceId?: unknown }, d: PickDeps): Promise<Result> {
  const p = await pickFor(token, input, d);
  if (!p.ok) return p.result;
  return { status: 200, body: { network: p.state.item, name: itemName(p.state.product, p.state.item), options: p.pick.options } };
}

/** Picked ids: 1 to 100 different short strings. Null for anything else. */
export function cleanIds(v: unknown): string[] | null {
  if (!Array.isArray(v) || !v.length || v.length > 100) return null;
  const ids = v.map((x) => (typeof x === "string" ? x.trim() : ""));
  if (ids.some((x) => !x || x.length > 200) || new Set(ids).size !== ids.length) return null;
  return ids;
}

/** POST /api/social/connect/pick/:token: connect the picked pages and accounts. Only ones the partner offered. */
export async function pickSave(token: string, input: { state?: unknown; workspaceId?: unknown; ids?: unknown }, d: PickDeps): Promise<Result> {
  const ids = cleanIds(input.ids);
  if (!ids) return fail(RETURN_MESSAGES.pickSome, 400);
  const p = await pickFor(token, input, d);
  if (!p.ok) return p.result;
  const offered = new Set(p.pick.options.map((o) => o.id));
  if (ids.some((id) => !offered.has(id))) return fail(RETURN_MESSAGES.pickSome, 400);
  const r = await p.client.pickConnect(token, ids);
  if (!r.ok) {
    d.log(`Pick connect for workspace ${p.state.ws} failed: ${r.status} ${r.code} ${r.message}`);
    if (r.status === 404 || r.status === 410) return fail(RETURN_MESSAGES.pickGone, 410);
    // The pick still works after these: the person can try again with fewer or other accounts.
    if (r.status === 409 && r.code === "plan_limit") return fail(RETURN_MESSAGES.pickLimit, 409);
    if (r.status === 409 && r.code === "taken") return fail(RETURN_MESSAGES.pickTaken, 409);
    if (r.status === 422) return fail(RETURN_MESSAGES.pickSome, 400);
    return r.retryable ? fail(CONNECT_MESSAGES.busy, 503) : fail(CONNECT_MESSAGES.broken, 502);
  }
  return { status: 200, body: { view: connectedView(p.state), connected: r.data.channels.length } };
}
