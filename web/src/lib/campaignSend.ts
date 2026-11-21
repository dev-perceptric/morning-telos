// Sends Iris's scheduled campaigns from the business's own Gmail or Outlook, a few at a time. The worker calls
// sendDue every minute (src/app/api/worker/route.ts). Each run sends at most PER_RUN emails per campaign and keeps
// each inbox under its daily limit (campaigns.ts DAILY_LIMIT), so a big list goes out over a day or more. Every email
// ends with the footer (mailing address and unsubscribe link). campaign_sends keeps who got it, so no one gets it
// twice, even if a run stops halfway. Pure: the database and Composio come in as deps (campaignSendServer.ts).
import { batchSize, emailFor, footer, type Campaign } from "./campaigns.ts";

export type DueCampaign = Pick<Campaign, "id" | "subject" | "body" | "list" | "status" | "sent_count" | "failed_count" | "from_app"> & { workspace_id: string };
export type NextContact = { id: string; email: string; name: string; token: string };
type App = "gmail" | "outlook";

export type SendDeps = {
  /** Campaigns scheduled or sending whose time has come. */
  due: (nowIso: string) => Promise<DueCampaign[]>;
  /** The workspace's connected inbox, Gmail first, or null. */
  inbox: (ws: string) => Promise<App | null>;
  /** The business's name and mailing address for the footer, or null without an address. */
  sender: (ws: string) => Promise<{ business: string; address: string } | null>;
  /** Campaign emails this workspace sent in the last 24 hours. */
  sentToday: (ws: string, sinceIso: string) => Promise<number>;
  next: (campaignId: string, n: number) => Promise<NextContact[]>;
  /** Sends one email. Throws with a plain reason when it can't. `stop` on the error means the inbox can't send at all. */
  send: (ws: string, app: App, to: string, subject: string, body: string) => Promise<void>;
  record: (row: { campaign_id: string; contact_id: string; workspace_id: string; status: "sent" | "failed"; error: string | null }) => Promise<void>;
  update: (id: string, patch: Partial<Pick<Campaign, "status" | "sent_count" | "failed_count" | "from_app">>) => Promise<void>;
  unsubscribeUrl: (token: string) => string;
  log: (message: string) => void;
  now?: () => number;
};

/** True when the inbox itself can't send (sign-in gone, limit reached), so the rest of this run is skipped. */
export const stops = (e: unknown) => Boolean((e as { stop?: boolean })?.stop);

export async function sendDue(d: SendDeps): Promise<{ sent: number; failed: number; finished: number }> {
  const now = (d.now ?? Date.now)();
  const since = new Date(now - 86_400_000).toISOString();
  const today = new Map<string, number>();
  const blocked = new Set<string>();
  const out = { sent: 0, failed: 0, finished: 0 };
  for (const c of await d.due(new Date(now).toISOString())) {
    const ws = c.workspace_id;
    if (blocked.has(ws)) continue;
    const app = c.from_app ?? (await d.inbox(ws));
    const who = await d.sender(ws);
    // No inbox or no address yet: it waits, and goes out once they're set.
    if (!app || !who) continue;
    if (!today.has(ws)) today.set(ws, await d.sentToday(ws, since));
    const n = batchSize(app, today.get(ws)!);
    if (!n) continue;
    if (c.status === "scheduled") await d.update(c.id, { status: "sending", from_app: app });
    const list = await d.next(c.id, n);
    let sent = 0, failed = 0;
    for (const contact of list) {
      const email = emailFor(contact, c, footer(who.business, who.address, d.unsubscribeUrl(contact.token)));
      try {
        await d.send(ws, app, contact.email, email.subject, email.body);
        await d.record({ campaign_id: c.id, contact_id: contact.id, workspace_id: ws, status: "sent", error: null });
        sent++;
      } catch (e) {
        if (stops(e)) {
          blocked.add(ws);
          d.log(`Campaign ${c.id}: the inbox can't send right now: ${e instanceof Error ? e.message : String(e)}`);
          break;
        }
        await d.record({ campaign_id: c.id, contact_id: contact.id, workspace_id: ws, status: "failed", error: (e instanceof Error ? e.message : String(e)).slice(0, 300) });
        failed++;
      }
    }
    today.set(ws, today.get(ws)! + sent);
    out.sent += sent;
    out.failed += failed;
    const done = !blocked.has(ws) && list.length < n;
    if (sent || failed || done) await d.update(c.id, { sent_count: c.sent_count + sent, failed_count: c.failed_count + failed, ...(done ? { status: "sent" } : {}) });
    if (done) out.finished++;
  }
  return out;
}
