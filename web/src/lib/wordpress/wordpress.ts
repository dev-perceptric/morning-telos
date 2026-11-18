// A customer's own (self-hosted) WordPress site, connected directly, not through Composio: the owner types their
// site's address, WordPress's own Approve screen makes an Application Password for "Morning Telos", and WordPress
// sends it back to our callback. Every call after that is the site's REST API (/wp-json/wp/v2/...) with Basic auth
// (user login and that password). Docs: developer.wordpress.org/rest-api and make.wordpress.org/core (Application
// Passwords integration guide).
//
// Every request goes through safeRequest (src/lib/siteFetch.ts): https only, never a private address, checked again
// on the IP it connects to, and a call that carries the login never follows a redirect.
// Pure: the network comes in as `fetch` (tests pass a fake). Not "server-only", so the tests load it.

import { allowedUrl, privateIp, safeRequest, type Answer, type SafeFetch } from "../siteFetch.ts";
import { openWith, sealWith, type Keyring } from "../sealing.ts";
import { isIP } from "node:net";

/** The name and fixed id WordPress shows on the owner's Application Passwords list. */
export const WP_APP_NAME = "Morning Telos";
export const WP_APP_ID = "8f6d3c1e-5b2a-4e7f-9c4d-2a1b0e9f7d63";
/** A connect link works for 15 minutes. */
export const WP_STATE_TTL_MS = 15 * 60_000;
const STATE_AAD = "wordpress-connect";

/** What the owner and the team read. Plain words, one short line each. */
export const WP_MESSAGES = {
  badAddress: "Type your site's address, like yourbusiness.com.",
  https: "Your site must use https. Turn it on first, or ask your web host.",
  private: "That address points to a private network.",
  unreachable: "We couldn't reach that site. Check the address and try again.",
  notWordpress: "We couldn't find WordPress at that address.",
  noAppPasswords: "Your site has Application Passwords turned off. Turn them on, or ask your web host.",
  expired: "The connect link ran out. Try again.",
  denied: "WordPress wasn't connected. You can try again any time.",
  wrongSite: "WordPress sent back a different site than the one you typed. Try again.",
  loginFailed: "WordPress didn't accept the new login. Try again.",
  failed: "We couldn't connect WordPress. Try again.",
  gone: "WordPress is already disconnected.",
  disconnected: "WordPress is disconnected. You can also remove Morning Telos in WordPress, under Users, Profile, Application Passwords.",
  reconnect: "WordPress didn't accept the login. Connect WordPress again in Settings, Apps.",
  moved: "Your WordPress site moved to another address. Connect WordPress again in Settings, Apps.",
  busy: "Your WordPress site didn't answer. Try again in a moment.",
} as const;

// ─────────────── the site's address ───────────────

/** The address the owner typed, as https://host/path with no ending slash. Refuses http, other ports and private addresses. */
export function siteAddress(raw: unknown): { ok: true; site: string } | { ok: false; error: string } {
  const typed = typeof raw === "string" ? raw.trim() : "";
  if (!typed || typed.length > 300 || /\s/.test(typed)) return { ok: false, error: WP_MESSAGES.badAddress };
  if (/^http:\/\//i.test(typed)) return { ok: false, error: WP_MESSAGES.https };
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(typed) && !/^https:\/\//i.test(typed)) return { ok: false, error: WP_MESSAGES.badAddress };
  let u: URL;
  try {
    u = new URL(/^https:\/\//i.test(typed) ? typed : `https://${typed}`);
  } catch {
    return { ok: false, error: WP_MESSAGES.badAddress };
  }
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && privateIp(host)) return { ok: false, error: WP_MESSAGES.private };
  const ok = allowedUrl(u.toString());
  if (!ok || ok.protocol !== "https:" || (!isIP(host) && !host.includes("."))) return { ok: false, error: WP_MESSAGES.badAddress };
  return { ok: true, site: `https://${ok.host.toLowerCase()}${ok.pathname.replace(/\/+$/, "")}` };
}

/** Two site addresses name the same site: same host and path, https, any ending slash or letter case in the host. */
export function sameSite(a: string, b: string): boolean {
  const norm = (v: string) => {
    try {
      const u = new URL(v.trim());
      return u.protocol === "https:" ? `${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, "")}` : null;
    } catch {
      return null;
    }
  };
  const x = norm(a);
  return x !== null && x === norm(b);
}

// ─────────────── finding WordPress on the site ───────────────

export type Found = {
  /** WordPress's own address (its `url`), which it sends back after the owner approves. */
  site: string;
  /** The REST API root, ending in /wp-json/. */
  api: string;
  name: string;
  /** WordPress's Approve screen for Application Passwords. */
  authorize: string;
};

const json = (a: Answer): unknown => {
  if (!a.reached) return null;
  try {
    return JSON.parse(a.body.toString("utf8"));
  } catch {
    return null;
  }
};
type J = Record<string, unknown>;
const at = (v: unknown, k: string): unknown => (v && typeof v === "object" ? (v as J)[k] : undefined);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/**
 * Reads https://<site>/wp-json/ (redirects followed, each one checked) and finds the Application Passwords Approve
 * screen in it (authentication["application-passwords"].endpoints.authorization). A line for the owner when it can't.
 */
export async function discover(site: string, o: { fetch?: SafeFetch } = {}): Promise<{ ok: true; found: Found } | { ok: false; error: string }> {
  const a = await safeRequest(`${site}/wp-json/`, { fetch: o.fetch, follow: true, headers: { Accept: "application/json" } });
  if (!a.reached) return { ok: false, error: /private network/.test(a.error) ? WP_MESSAGES.private : /https/.test(a.error) ? WP_MESSAGES.https : WP_MESSAGES.unreachable };
  const d = json(a);
  const namespaces = at(d, "namespaces");
  if (a.status !== 200 || !Array.isArray(namespaces) || !namespaces.includes("wp/v2")) return { ok: false, error: WP_MESSAGES.notWordpress };
  const authorize = str(at(at(at(at(d, "authentication"), "application-passwords"), "endpoints"), "authorization"));
  if (!authorize) return { ok: false, error: WP_MESSAGES.noAppPasswords };
  const auth = allowedUrl(authorize);
  const api = new URL(a.url);
  const wpUrl = siteAddress(str(at(d, "url")) || site);
  if (!auth || auth.protocol !== "https:" || api.protocol !== "https:" || !api.pathname.endsWith("/wp-json/") || !wpUrl.ok) return { ok: false, error: WP_MESSAGES.https };
  api.search = "";
  return { ok: true, found: { site: wpUrl.site, api: api.toString(), name: str(at(d, "name")).slice(0, 200), authorize: auth.toString() } };
}

/** WordPress's Approve screen for this site, coming back to `callback` (success) or `callback` with rejected=1. */
export function authorizeUrl(found: Pick<Found, "authorize">, callback: string): string {
  const u = new URL(found.authorize);
  const back = new URL(callback);
  const reject = new URL(callback);
  reject.searchParams.set("rejected", "1");
  u.searchParams.set("app_name", WP_APP_NAME);
  u.searchParams.set("app_id", WP_APP_ID);
  u.searchParams.set("success_url", back.toString());
  u.searchParams.set("reject_url", reject.toString());
  return u.toString();
}

// ─────────────── the state ───────────────

export type WpState = { ws: string; user: string; site: string; api: string; exp: number };

/**
 * The sealed note the way back reads: which workspace, person and site, and until when. base64url, so it survives
 * WordPress adding its own query to the address.
 */
export function signWpState(ring: Keyring, s: Omit<WpState, "exp">, now = Date.now()): string {
  return Buffer.from(sealWith(ring, JSON.stringify({ ...s, exp: now + WP_STATE_TTL_MS }), STATE_AAD), "utf8").toString("base64url");
}

/** The note, when this server sealed it and it hasn't run out. Null for anything else. */
export function readWpState(ring: Keyring, raw: string, now = Date.now()): WpState | null {
  try {
    const s = JSON.parse(openWith(ring, Buffer.from(raw, "base64url").toString("utf8"), STATE_AAD)) as Partial<WpState>;
    if (typeof s.ws !== "string" || typeof s.user !== "string" || typeof s.site !== "string" || typeof s.api !== "string" || typeof s.exp !== "number") return null;
    if (s.exp < now) return null;
    return { ws: s.ws, user: s.user, site: s.site, api: s.api, exp: s.exp };
  } catch {
    return null;
  }
}

/** The AAD a WordPress password is sealed with, so it can't be moved to another workspace's row. */
export const passwordAad = (workspaceId: string) => `${workspaceId}:wordpress`;

// ─────────────── calling the site ───────────────

/** One working connection: the REST root, the WordPress user and its Application Password. */
export type WpLogin = { api: string; login: string; password: string };

/** login: WordPress no longer takes the login (the connection is marked broken). moved: the site sent us elsewhere. */
export type WpErrorKind = "login" | "moved" | "refused" | "busy";
export class WpError extends Error {
  readonly kind: WpErrorKind;
  readonly status: number;
  constructor(kind: WpErrorKind, message: string, status = 0) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}
/** The connection needs connecting again (marked broken, and the owner is told). */
export const brokenLogin = (e: unknown) => e instanceof WpError && (e.kind === "login" || e.kind === "moved");

// WordPress's own codes for a login it won't take.
const LOGIN_CODES = /^(incorrect_password|invalid_username|invalid_email|rest_not_logged_in|application_passwords_disabled|application_passwords_disabled_for_user|rest_authentication_error)$/;

export type WpRequest = {
  method: "GET" | "POST";
  /** Under the REST root: "wp/v2/pages", "wp/v2/posts/12", "" for the root itself. */
  path: string;
  query?: Record<string, string | number | undefined>;
  json?: Record<string, unknown>;
  /** A file to upload (media), sent as it is. */
  file?: { data: Uint8Array; type: string; name: string };
};
export type WpNet = { fetch?: SafeFetch; sleep?: (ms: number) => Promise<void>; tries?: number };

/** The address for a request, under the login's REST root only. */
export function requestUrl(api: string, path: string, query: WpRequest["query"] = {}): string {
  if (!/^[a-z0-9/_-]*$/i.test(path) || path.includes("..") || path.startsWith("/")) throw new WpError("refused", "That isn't a WordPress address.");
  const u = new URL(path, api);
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") u.searchParams.set(k, String(v));
  return u.toString();
}

/** WordPress's own short reason, with no HTML. */
const reason = (d: unknown) =>
  str(at(d, "message"))
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 200);

/**
 * One REST call with the login. Hiccups (no answer, 429, 5xx) are tried again with growing waits (1s, 3s), a change
 * only when WordPress said it was busy (429, 503), so a slow save is never made twice. Returns the JSON answer.
 */
export async function wpCall(login: WpLogin, req: WpRequest, o: WpNet = {}): Promise<unknown> {
  const url = requestUrl(login.api, req.path, req.query);
  const headers: Record<string, string> = { Accept: "application/json", Authorization: `Basic ${Buffer.from(`${login.login}:${login.password}`, "utf8").toString("base64")}` };
  let body: string | Uint8Array | undefined;
  if (req.file) {
    headers["Content-Type"] = req.file.type;
    headers["Content-Disposition"] = `attachment; filename="${req.file.name.replace(/[^A-Za-z0-9._-]/g, "-")}"`;
    body = req.file.data;
  } else if (req.json) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(req.json);
  }
  const tries = o.tries ?? 3;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let i = 0; ; i++) {
    const a = await safeRequest(url, { method: req.method, headers, body, fetch: o.fetch, timeoutMs: req.file ? 60_000 : 20_000 });
    const again = req.method === "GET" ? !a.reached ? a.retryable : a.status === 429 || a.status >= 500 : a.reached && (a.status === 429 || a.status === 503);
    if (again && i < tries - 1) {
      await sleep(1000 * 3 ** i);
      continue;
    }
    return answerOf(a);
  }
}

function answerOf(a: Answer): unknown {
  if (!a.reached) throw new WpError(a.retryable ? "busy" : "refused", a.retryable ? WP_MESSAGES.busy : a.error);
  const d = json(a);
  const code = str(at(d, "code"));
  if (a.status === 401 || LOGIN_CODES.test(code)) throw new WpError("login", WP_MESSAGES.reconnect, a.status);
  if (a.status >= 300 && a.status < 400) throw new WpError("moved", WP_MESSAGES.moved, a.status);
  if (a.status === 429 || a.status >= 500) throw new WpError("busy", WP_MESSAGES.busy, a.status);
  if (a.status === 403) throw new WpError("refused", `Your WordPress user isn't allowed to do that.${reason(d) ? ` WordPress said: ${reason(d)}` : ""}`.slice(0, 260), 403);
  if (a.status === 404) throw new WpError("refused", "WordPress couldn't find that page or post.", 404);
  if (a.status >= 400) throw new WpError("refused", (reason(d) ? `WordPress said: ${reason(d)}` : `WordPress answered with an error (${a.status}).`).slice(0, 260), a.status);
  if (d === null || a.cut) throw new WpError("refused", "Your WordPress site didn't answer with data. A security plugin may be blocking it.", a.status);
  return d;
}

/** The one read that tests a new login: who it signs in as. Throws a WpError when WordPress won't take it. */
export async function whoAmI(login: WpLogin, o: WpNet = {}): Promise<{ id: number; name: string }> {
  const d = await wpCall(login, { method: "GET", path: "wp/v2/users/me", query: { context: "edit", _fields: "id,name,slug" } }, o);
  const id = Number(at(d, "id"));
  if (!Number.isSafeInteger(id) || id <= 0) throw new WpError("login", WP_MESSAGES.loginFailed);
  return { id, name: str(at(d, "name")).slice(0, 200) };
}
