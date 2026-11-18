// Connecting an app on Composio: find the toolkit's auth config (one set by hand in COMPOSIO_AUTH_CONFIG_<TOOLKIT>,
// else the project's own, else a new Composio-managed one), open Composio's hosted connect page for the workspace's
// Composio user, and when the person comes back, check the connected account is that workspace's, for that app, and
// ACTIVE before it's saved. The way there carries a sealed note (the state) of which workspace, person and app, so
// the way back can't be pointed at another workspace.
// Copied from Omniscient's src/lib/composio/connect.ts (and signState/readState from its google.ts, sealed with
// sealing.ts here). Not "server-only", so the tests load it; only server code imports it.

import { openWith, sealWith, type Keyring } from "../sealing.ts";
import { TOOLKITS } from "./catalog.ts";
import { authConfigEnv, composioCall, proxyGet, type ComposioTool, type Net } from "./composio.ts";

// ─────────────── the state ───────────────

/** A connect link works for 30 minutes. */
export const STATE_TTL_MS = 30 * 60_000;
const STATE_AAD = "composio-connect";

export type ConnectState = { ws: string; user: string; toolkit: string; exp: number };

/** The sealed note the way back reads: which workspace, person and app, and until when. */
export function signState(ring: Keyring, s: Omit<ConnectState, "exp">, now = Date.now()): string {
  return sealWith(ring, JSON.stringify({ ...s, exp: now + STATE_TTL_MS }), STATE_AAD);
}

/** The note, when it was sealed by this server and hasn't run out. Null for anything else. */
export function readState(ring: Keyring, sealed: string, now = Date.now()): ConnectState | null {
  try {
    const s = JSON.parse(openWith(ring, sealed, STATE_AAD)) as Partial<ConnectState>;
    if (typeof s.ws !== "string" || typeof s.user !== "string" || typeof s.toolkit !== "string" || typeof s.exp !== "number") return null;
    if (s.exp < now || !TOOLKITS[s.toolkit]) return null;
    return { ws: s.ws, user: s.user, toolkit: s.toolkit, exp: s.exp };
  } catch {
    return null;
  }
}

// ─────────────── auth configs and the connect page ───────────────

const configs = new Map<string, string>();
/** Forget the auth configs found (tests). */
export const forgetConfigs = () => configs.clear();

type AuthConfigItem = { id: string; status?: string; is_composio_managed?: boolean; auth_scheme?: string; toolkit?: { slug?: string } };

/** The auth config a toolkit's connections use: set by hand, the project's own, or a new one Composio manages. */
export async function authConfigFor(t: ComposioTool, o: Net = {}): Promise<string> {
  const set = authConfigEnv(t.toolkit, o.env);
  if (set) return set;
  const known = configs.get(t.toolkit);
  if (known) return known;
  const list = await composioCall<{ items?: AuthConfigItem[] }>(`/api/v3.1/auth_configs?${new URLSearchParams({ toolkit_slug: t.toolkit, limit: "50" })}`, o);
  const fits = (list.items ?? []).filter((c) => c.status !== "DISABLED" && (c.toolkit?.slug ?? t.toolkit) === t.toolkit && (!c.auth_scheme || c.auth_scheme === t.scheme));
  let id: string | undefined = (t.managed ? fits.find((c) => c.is_composio_managed) : undefined)?.id ?? fits[0]?.id;
  if (!id) {
    if (!t.managed) throw new Error(`Set COMPOSIO_AUTH_CONFIG_${t.toolkit.toUpperCase()} on the server first.`);
    const made = await composioCall<{ auth_config?: { id?: string } }>("/api/v3.1/auth_configs", {
      ...o,
      method: "POST",
      body: JSON.stringify({ toolkit: { slug: t.toolkit }, auth_config: { type: "use_composio_managed_auth" } }),
    });
    id = made.auth_config?.id;
    if (!id) throw new Error("Composio didn't make an auth config.");
  }
  configs.set(t.toolkit, id);
  return id;
}

/** Composio's hosted connect page for this Composio user and toolkit, coming back to `callbackUrl`. */
export async function connectLink(toolkit: string, user: string, callbackUrl: string, o: Net = {}): Promise<{ url: string; account: string }> {
  const t = TOOLKITS[toolkit];
  if (!t) throw new Error("This app can't be connected here.");
  const auth_config_id = await authConfigFor(t, o);
  const d = await composioCall<{ redirect_url?: string; connected_account_id?: string }>("/api/v3.1/connected_accounts/link", {
    ...o,
    method: "POST",
    body: JSON.stringify({ auth_config_id, user_id: user, callback_url: callbackUrl }),
  }).catch((e: Error) => {
    // A config removed on Composio since it was found here: look it up again next time.
    configs.delete(t.toolkit);
    throw e;
  });
  if (!d.redirect_url || !/^https:\/\//.test(d.redirect_url) || !d.connected_account_id) throw new Error("Composio didn't open a connect page.");
  return { url: d.redirect_url, account: d.connected_account_id };
}

// ─────────────── the way back ───────────────

export type ConnectedAccount = { id: string; status: string; status_reason?: string | null; user_id?: string; toolkit?: { slug?: string }; is_disabled?: boolean };

export const ACCOUNT_ID = /^[A-Za-z0-9_-]{4,100}$/;

/**
 * The connected account once it's ACTIVE: right after the person comes back it can still be finishing, so it's
 * asked again a few times. Anything else (failed, expired, another workspace's or another app's) is refused.
 */
export async function activeAccount(toolkit: string, user: string, id: string, o: Net & { sleep?: (ms: number) => Promise<void>; tries?: number } = {}): Promise<ConnectedAccount> {
  const t = TOOLKITS[toolkit];
  if (!t || !ACCOUNT_ID.test(id)) throw new Error("Could not connect.");
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  // The way back names the account in its address, which anyone can change: it counts only if it's this
  // workspace's own (its Composio user) for this app.
  const mine = await composioCall<{ items?: { id: string }[] }>(`/api/v3.1/connected_accounts?${new URLSearchParams({ user_ids: user, toolkit_slugs: t.toolkit, limit: "200" })}`, o);
  if (!(mine.items ?? []).some((x) => x.id === id)) throw new Error("That connection isn't this workspace's.");
  for (let i = 0; ; i++) {
    const a = await composioCall<ConnectedAccount>(`/api/v3.1/connected_accounts/${encodeURIComponent(id)}`, o);
    if (a.toolkit?.slug && a.toolkit.slug !== t.toolkit) throw new Error("That connection is for another app.");
    if (a.user_id && a.user_id !== user) throw new Error("That connection isn't this workspace's.");
    if (a.status === "ACTIVE" && !a.is_disabled) return a;
    if (!["INITIALIZING", "INITIATED"].includes(a.status) || i >= (o.tries ?? 5)) {
      throw new Error(a.status_reason ? `It didn't connect: ${a.status_reason}`.slice(0, 200) : "It didn't finish connecting. Try again.");
    }
    await sleep(1000);
  }
}

/** Remove a connected account at Composio (a disconnect, a reconnect, a closed workspace). Never throws. */
export async function dropAccount(id: string, o: Net = {}): Promise<boolean> {
  if (!ACCOUNT_ID.test(id)) return false;
  return composioCall(`/api/v3.1/connected_accounts/${encodeURIComponent(id)}`, { ...o, method: "DELETE" }).then(
    () => true,
    () => false,
  );
}

// ─────────────── the account's label ───────────────

type J = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : null);
const at = (v: unknown, k: string) => (v && typeof v === "object" ? (v as J)[k] : undefined);

/** Where each app says which account this is (its email, or its team's name), and how to read the answer. */
const WHO: Record<string, { url: string; pick: (d: unknown) => string | null }> = {
  gmail: { url: "https://gmail.googleapis.com/gmail/v1/users/me/profile", pick: (d) => str(at(d, "emailAddress")) },
  googlecalendar: { url: "https://www.googleapis.com/calendar/v3/calendars/primary", pick: (d) => str(at(d, "id")) },
  outlook: { url: "https://graph.microsoft.com/v1.0/me", pick: (d) => str(at(d, "mail")) ?? str(at(d, "userPrincipalName")) },
  calendly: { url: "https://api.calendly.com/users/me", pick: (d) => str(at(at(d, "resource"), "email")) },
  slack: { url: "https://slack.com/api/auth.test", pick: (d) => str(at(d, "team")) },
  salesforce: { url: "https://login.salesforce.com/services/oauth2/userinfo", pick: (d) => str(at(d, "email")) },
  help_scout: { url: "https://api.helpscout.net/v2/users/me", pick: (d) => str(at(d, "email")) },
};

/** The connected account's label for the Apps page (the email it's signed in as). Null when the app won't say. */
export async function accountLabel(toolkit: string, account: string, user: string, o: Net = {}): Promise<string | null> {
  const who = WHO[toolkit];
  if (!who) return null;
  try {
    return who.pick(await proxyGet(account, user, who.url, o));
  } catch {
    return null;
  }
}
