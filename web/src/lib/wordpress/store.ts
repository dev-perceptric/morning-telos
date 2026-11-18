// The workspace's WordPress connection (supabase/020_wordpress.sql): wordpress_sites, which members read (the site
// address, the WordPress user and whether it works), and wordpress_logins, server only, with the sealed Application
// Password. Only the server writes them, with the full-access client: the connect callback saves (save_wordpress, one
// step for both tables), disconnect and closing a workspace remove, and a refused login marks it to connect again.
// Not "server-only", so the tests load it; only server code imports it.

import type { SupabaseClient } from "@supabase/supabase-js";

export type WpSiteRow = { workspace_id: string; site_url: string; user_login: string; status: "active" | "reconnect"; connected_by: string | null; created_at: string };
/** The site with its login, for the server only. */
export type WpRow = WpSiteRow & { api_root: string; sealed_password: string };

const SITE_COLS = "workspace_id, site_url, user_login, status, connected_by, created_at";
const MISSING = /wordpress_(sites|logins)|save_wordpress/;
const noTable = (m: string) => (MISSING.test(m) ? "Run supabase/020_wordpress.sql first." : m);

/** The workspace's WordPress site as members see it, or null. Null before 020 runs. */
export async function wordpressSite(db: SupabaseClient, ws: string): Promise<WpSiteRow | null> {
  const { data, error } = await db.from("wordpress_sites").select(SITE_COLS).eq("workspace_id", ws).maybeSingle();
  if (error) {
    if (MISSING.test(error.message)) return null;
    throw new Error(`WordPress wasn't read: ${error.message}`);
  }
  const row = (data as WpSiteRow | null) ?? null;
  return row && row.workspace_id === ws ? row : null;
}

/** The site and its sealed login, for the server's tools. Null when either half is missing. */
export async function wordpressLogin(db: SupabaseClient, ws: string): Promise<WpRow | null> {
  const site = await wordpressSite(db, ws);
  if (!site) return null;
  const { data, error } = await db.from("wordpress_logins").select("workspace_id, api_root, sealed_password").eq("workspace_id", ws).maybeSingle();
  if (error) throw new Error(`WordPress wasn't read: ${noTable(error.message)}`);
  const login = data as { workspace_id: string; api_root: string; sealed_password: string } | null;
  return login && login.workspace_id === ws ? { ...site, api_root: login.api_root, sealed_password: login.sealed_password } : null;
}

/** Save a new connection or replace the old one, both tables in one step. */
export async function saveWordpress(db: SupabaseClient, o: { ws: string; site: string; login: string; api: string; sealed: string; userId: string }): Promise<void> {
  const { error } = await db.rpc("save_wordpress", { p_ws: o.ws, p_site: o.site, p_login: o.login, p_api: o.api, p_sealed: o.sealed, p_by: o.userId });
  if (error) throw new Error(noTable(error.message));
}

/** Remove the workspace's WordPress connection (its login goes with it). True when there was one. */
export async function removeWordpress(db: SupabaseClient, ws: string): Promise<boolean> {
  const had = await wordpressSite(db, ws);
  if (!had) return false;
  const { error } = await db.from("wordpress_sites").delete().eq("workspace_id", ws);
  if (error) throw new Error(noTable(error.message));
  return true;
}

/** WordPress no longer takes the login: the Apps page asks to connect it again. */
export async function markWordpressBroken(db: SupabaseClient, ws: string, why: string): Promise<void> {
  const now = new Date().toISOString();
  const a = await db.from("wordpress_sites").update({ status: "reconnect", updated_at: now }).eq("workspace_id", ws);
  if (a.error) throw new Error(a.error.message);
  const b = await db.from("wordpress_logins").update({ last_error: why.slice(0, 300), updated_at: now }).eq("workspace_id", ws);
  if (b.error) throw new Error(b.error.message);
}

/** A workspace that is deleted or closed: its WordPress login is removed here. Best effort, never throws. */
export async function closeWordpress(db: SupabaseClient, ws: string, log?: (m: string) => void): Promise<void> {
  try {
    await removeWordpress(db, ws);
  } catch (e) {
    log?.(`WordPress for workspace ${ws} wasn't removed at close: ${e instanceof Error ? e.message : String(e)}`);
  }
}
