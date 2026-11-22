// The database and Composio behind Cyrus's campaigns (src/lib/campaignSend.ts, src/lib/emailWork.ts). Server only.
import type { SupabaseClient } from "@supabase/supabase-js";
import * as Sentry from "@sentry/nextjs";
import { cleanAddress } from "./campaigns.ts";
import type { NextContact, SendDeps } from "./campaignSend.ts";
import { AppSetupError, needsReconnect, runTool } from "./composio/actions.ts";
import { composioOn, composioUser } from "./composio/composio.ts";
import { connectionsOf, markReconnect } from "./composio/store.ts";
import { appUrl } from "./emailKit.ts";

export function log(message: string) {
  console.error(message);
  Sentry.captureMessage(message, { level: "warning", tags: { area: "campaigns" } });
}

const must = <T,>(r: { data: T | null; error: { message: string } | null }) => {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
};

type App = "gmail" | "outlook";

/** The workspace's connected inbox, Gmail first. */
export async function inboxOf(db: SupabaseClient, ws: string): Promise<App | null> {
  const rows = (await connectionsOf(db, ws)).filter((c) => c.status === "active");
  return rows.some((c) => c.toolkit === "gmail") ? "gmail" : rows.some((c) => c.toolkit === "outlook") ? "outlook" : null;
}

/** The business's name and Cyrus's mailing address (agent_prefs.settings.mail_address), or null without an address. */
export async function senderOf(db: SupabaseClient, ws: string): Promise<{ business: string; address: string } | null> {
  const [w, p] = await Promise.all([
    db.from("workspaces").select("name").eq("id", ws).maybeSingle(),
    db.from("agent_prefs").select("settings").eq("workspace_id", ws).eq("agent", "email").maybeSingle(),
  ]);
  const address = cleanAddress((p.data as { settings?: Record<string, unknown> } | null)?.settings?.mail_address);
  const business = (w.data as { name?: string } | null)?.name ?? "";
  return address && business ? { business, address } : null;
}

/** Sends one plain email from the workspace's own inbox. An error with `stop` means the inbox can't send at all. */
export async function sendOne(db: SupabaseClient, ws: string, app: App, to: string, subject: string, body: string): Promise<void> {
  if (!composioOn()) throw Object.assign(new Error("Apps aren't set up on the server yet."), { stop: true });
  const row = (await connectionsOf(db, ws)).find((c) => c.toolkit === app && c.status === "active");
  if (!row) throw Object.assign(new Error(`Connect ${app === "gmail" ? "Gmail" : "Outlook"} in Settings, Apps.`), { stop: true });
  const conn = { toolkit: app, account: row.composio_account, user: composioUser(ws) };
  const args = app === "gmail" ? { recipient_email: to, subject, body, is_html: false } : { to, subject, body, is_html: false };
  try {
    await runTool(conn, app === "gmail" ? "GMAIL_SEND_EMAIL" : "OUTLOOK_SEND_EMAIL", args);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (needsReconnect(e)) {
      await markReconnect(db, ws, app, msg).catch(() => {});
      throw Object.assign(new Error(msg), { stop: true });
    }
    // The inbox's own daily limit: stop for today.
    if (/limit|quota|too many|rate/i.test(msg)) throw Object.assign(new Error(msg), { stop: true });
    throw e instanceof AppSetupError ? e : new Error("The email didn't go out. It's tried again later.");
  }
}

export function sendDeps(db: SupabaseClient): SendDeps {
  return {
    due: async (now) =>
      must(await db.from("campaigns").select("id, workspace_id, subject, body, list, status, sent_count, failed_count, from_app").in("status", ["scheduled", "sending"]).lte("send_at", now).order("send_at").limit(20)) as Awaited<ReturnType<SendDeps["due"]>>,
    inbox: (ws) => inboxOf(db, ws),
    sender: (ws) => senderOf(db, ws),
    sentToday: async (ws, since) => {
      const { count, error } = await db.from("campaign_sends").select("contact_id", { count: "exact", head: true }).eq("workspace_id", ws).eq("status", "sent").gte("at", since);
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
    next: async (id, n) => must(await db.rpc("next_campaign_contacts", { p_campaign: id, p_n: n })) as NextContact[],
    send: (ws, app, to, subject, body) => sendOne(db, ws, app, to, subject, body),
    record: async (row) => {
      must(await db.from("campaign_sends").upsert(row, { onConflict: "campaign_id,contact_id" }));
    },
    update: async (id, patch) => {
      must(await db.from("campaigns").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id));
    },
    unsubscribeUrl: (token) => `${appUrl()}/api/unsubscribe?t=${token}`,
    log,
  };
}
