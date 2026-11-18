// The app_connections rows (supabase/016_app_connections.sql): one per workspace and app. Only the server writes them,
// with the full-access client: the connect callback saves, disconnect and closing a workspace remove. Members read
// labels and status through row level security.
// Copied from Omniscient's src/lib/composio/store.ts and trimmed (no personal apps, no app settings). Not
// "server-only", so the tests load it; only server code imports it.

import type { SupabaseClient } from "@supabase/supabase-js";
import { isToolkit } from "./catalog.ts";
import { dropAccount } from "./connect.ts";
import type { Net } from "./composio.ts";

export type ConnRow = { id: string; workspace_id: string; toolkit: string; composio_account: string; status: "active" | "reconnect"; account_label: string | null; connected_by: string | null; created_at: string };

const COLS = "id, workspace_id, toolkit, composio_account, status, account_label, connected_by, created_at";
const MISSING = /app_connections/;
const noTable = (m: string) => (MISSING.test(m) ? "Run supabase/016_app_connections.sql first." : m);

/** The workspace's connections, oldest first. Empty before 016 runs. */
export async function connectionsOf(db: SupabaseClient, ws: string): Promise<ConnRow[]> {
  const { data, error } = await db.from("app_connections").select(COLS).eq("workspace_id", ws).order("created_at");
  if (error) {
    if (MISSING.test(error.message)) return [];
    throw new Error(`Apps weren't read: ${error.message}`);
  }
  return ((data ?? []) as ConnRow[]).filter((r) => r.workspace_id === ws && isToolkit(r.toolkit));
}

/** The workspace's connection for one app, or null. */
export async function connectionFor(db: SupabaseClient, ws: string, toolkit: string): Promise<ConnRow | null> {
  const { data, error } = await db.from("app_connections").select(COLS).eq("workspace_id", ws).eq("toolkit", toolkit).maybeSingle();
  if (error) {
    if (MISSING.test(error.message)) return null;
    throw new Error(`Apps weren't read: ${error.message}`);
  }
  return (data as ConnRow | null) ?? null;
}

/** Save a connection (a new one, or a reconnect). Returns the Composio account it replaced, if any. */
export async function saveConnection(db: SupabaseClient, o: { ws: string; toolkit: string; userId: string; account: string; label: string | null }): Promise<{ old: string | null }> {
  const before = await connectionFor(db, o.ws, o.toolkit);
  const row = { composio_account: o.account, status: "active", last_error: null, account_label: o.label, connected_by: o.userId, updated_at: new Date().toISOString() };
  if (before) {
    const old = before.composio_account;
    const { error } = await db.from("app_connections").update(row).eq("id", before.id).eq("workspace_id", o.ws);
    if (error) throw new Error(noTable(error.message));
    return { old: old === o.account ? null : old };
  }
  const { error } = await db.from("app_connections").insert({ workspace_id: o.ws, toolkit: o.toolkit, ...row });
  if (error) throw new Error(noTable(error.message));
  return { old: null };
}

/** Remove one of the workspace's connections here. Returns the row it removed, or null when it was gone. */
export async function removeConnection(db: SupabaseClient, ws: string, id: string): Promise<ConnRow | null> {
  const { data, error } = await db.from("app_connections").select(COLS).eq("id", id).eq("workspace_id", ws).maybeSingle();
  if (error) throw new Error(noTable(error.message));
  const row = (data as ConnRow | null) ?? null;
  if (!row) return null;
  const del = await db.from("app_connections").delete().eq("id", row.id).eq("workspace_id", ws);
  if (del.error) throw new Error(del.error.message);
  return row;
}

/** A connection Composio says is gone: the Apps page asks to connect it again. */
export async function markReconnect(db: SupabaseClient, ws: string, toolkit: string, why: string): Promise<void> {
  const { error } = await db.from("app_connections").update({ status: "reconnect", last_error: why.slice(0, 300), updated_at: new Date().toISOString() }).eq("workspace_id", ws).eq("toolkit", toolkit);
  if (error) throw new Error(error.message);
}

/**
 * A workspace that is deleted or closed (its subscription ended): every connected account is removed at Composio
 * and here. Best effort: Composio being down never stops the close. Returns how many were removed at Composio.
 */
export async function closeApps(db: SupabaseClient, ws: string, o: Net & { log?: (m: string) => void } = {}): Promise<number> {
  let rows: ConnRow[];
  try {
    rows = await connectionsOf(db, ws);
  } catch (e) {
    o.log?.(`Apps for workspace ${ws} weren't read at close: ${e instanceof Error ? e.message : String(e)}`);
    return 0;
  }
  let dropped = 0;
  for (const r of rows) {
    if (await dropAccount(r.composio_account, o)) dropped++;
    else o.log?.(`Composio account for ${r.toolkit} in workspace ${ws} wasn't removed at close.`);
  }
  if (rows.length) {
    const { error } = await db.from("app_connections").delete().eq("workspace_id", ws);
    if (error) o.log?.(`Apps for workspace ${ws} weren't removed at close: ${error.message}`);
  }
  return dropped;
}
