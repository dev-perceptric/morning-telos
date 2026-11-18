// Connecting a self-hosted WordPress site, both halves, for the routes (src/app/api/apps/wordpress):
//   startConnect   the owner typed the site's address: find WordPress there (https only, public addresses only) and
//                  make the link to its Approve screen, with a sealed note (state) of which workspace, person and site.
//   finishConnect  WordPress came back with site_url, user_login and password: check the note, the person (still an
//                  owner or admin), the site (the one asked for), test the login with one read, then seal and save it.
// Pure: the database, the keys and the network come in as deps, so tests use fakes. Not "server-only".

import { APP_MESSAGES } from "../composio/catalog.ts";
import { sealWith, type Keyring } from "../sealing.ts";
import { atLeast, isRole } from "../workspace.ts";
import { authorizeUrl, brokenLogin, discover, passwordAad, readWpState, sameSite, signWpState, siteAddress, whoAmI, WP_MESSAGES, WpError, type WpNet } from "./wordpress.ts";

export type Result = { ok: true } | { ok: false; error: string };

/** The link to WordPress's Approve screen for the site the owner typed, or a line saying why not. */
export async function startConnect(o: { ring: Keyring; ws: string; user: string; site: unknown; origin: string; net?: WpNet; now?: number }): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const typed = siteAddress(o.site);
  if (!typed.ok) return typed;
  const d = await discover(typed.site, { fetch: o.net?.fetch });
  if (!d.ok) return d;
  const state = signWpState(o.ring, { ws: o.ws, user: o.user, site: d.found.site, api: d.found.api }, o.now);
  const callback = `${o.origin.replace(/\/+$/, "")}/api/apps/wordpress/callback?${new URLSearchParams({ state })}`;
  return { ok: true, url: authorizeUrl(d.found, callback) };
}

export type FinishDeps = {
  ring: Keyring;
  /** The person's role in the workspace now, or null. */
  roleOf: (ws: string, user: string) => Promise<string | null>;
  save: (row: { ws: string; site: string; login: string; api: string; sealed: string; userId: string }) => Promise<void>;
  net?: WpNet;
  now?: number;
};

/** The way back from WordPress. Saves the connection only when every check passes. */
export async function finishConnect(q: URLSearchParams, deps: FinishDeps): Promise<Result & { ws?: string }> {
  const state = readWpState(deps.ring, q.get("state") ?? "", deps.now);
  if (!state) return { ok: false, error: WP_MESSAGES.expired };
  if (q.get("rejected") === "1" || q.get("success") === "false") return { ok: false, error: WP_MESSAGES.denied, ws: state.ws };
  const role = await deps.roleOf(state.ws, state.user);
  if (!isRole(role) || !atLeast(role, "admin")) return { ok: false, error: APP_MESSAGES.adminsOnly, ws: state.ws };
  const site = q.get("site_url") ?? "";
  const login = (q.get("user_login") ?? "").trim();
  const password = (q.get("password") ?? "").trim();
  if (!login || login.length > 200 || !password || password.length > 200) return { ok: false, error: WP_MESSAGES.denied, ws: state.ws };
  if (!sameSite(site, state.site)) return { ok: false, error: WP_MESSAGES.wrongSite, ws: state.ws };
  try {
    await whoAmI({ api: state.api, login, password }, deps.net);
  } catch (e) {
    return { ok: false, error: e instanceof WpError && !brokenLogin(e) ? e.message : WP_MESSAGES.loginFailed, ws: state.ws };
  }
  await deps.save({ ws: state.ws, site: state.site, login, api: state.api, sealed: sealWith(deps.ring, password, passwordAad(state.ws)), userId: state.user });
  return { ok: true, ws: state.ws };
}
