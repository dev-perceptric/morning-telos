import * as Sentry from "@sentry/nextjs";
import { APP_MESSAGES, APPS, appName, isToolkit, TOOLKITS } from "@/lib/composio/catalog";
import { composioOn, composioUser, connectable } from "@/lib/composio/composio";
import { connectLink, dropAccount, signState } from "@/lib/composio/connect";
import { connectionsOf, removeConnection } from "@/lib/composio/store";
import { envKeyring } from "@/lib/sealing";
import { adminClient, appOrigin, roleGate } from "@/lib/serverAuth";
import { NEEDS } from "@/lib/workspace";
import { wordpressSite } from "@/lib/wordpress/store";

// Settings, Apps: the customer's own apps through Composio (src/lib/composio). POST { workspaceId, ... }:
//   list        (members)          whether apps work on this server, which apps connect now, and the connections
//                                  (the self-hosted WordPress site too: src/app/api/apps/wordpress connects it)
//   connect     { toolkit } (admins) Composio's hosted sign-in page for the app, for the workspace's Composio user.
//                                  It comes back to GET /api/apps/composio with a sealed note of who and which app.
//   disconnect  { id } (admins)    removes the connection here and at Composio
// Copied from Omniscient's src/app/api/apps/[action]/route.ts and trimmed.
export const dynamic = "force-dynamic";

function log(message: string) {
  console.error(message);
  Sentry.captureMessage(message, { level: "warning", tags: { area: "apps" } });
}

const reply = (body: Record<string, unknown>, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const str = (v: unknown, max = 100) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function POST(request: Request, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const ws = body.workspaceId;
  const { gate } = roleGate(request, ws);
  if (!["list", "connect", "disconnect"].includes(action)) return reply({ error: "Unknown action." }, 404);
  const who = await gate(action === "list" ? NEEDS.viewApps : NEEDS.connectApps);
  if (!who.ok) return reply({ error: action === "list" || who.status !== 403 ? who.error : APP_MESSAGES.adminsOnly }, who.status);
  const wsId = ws as string;
  const db = adminClient();
  if (!db) return reply({ error: "Add SUPABASE_SECRET_KEY to the server's settings." }, 500);

  try {
    if (action === "list") {
      const [rows, wp] = await Promise.all([connectionsOf(db, wsId), wordpressSite(db, wsId)]);
      return reply({
        wordpress: wp ? { site: wp.site_url, login: wp.user_login, status: wp.status, created_at: wp.created_at } : null,
        on: composioOn(),
        connectable: APPS.filter((a) => connectable(a)).map((a) => a.toolkit),
        connections: rows.map((r) => ({ id: r.id, toolkit: r.toolkit, status: r.status, label: r.account_label, created_at: r.created_at })),
      });
    }

    if (action === "connect") {
      if (!composioOn()) return reply({ error: APP_MESSAGES.off }, 400);
      const toolkit = str(body.toolkit, 60);
      if (!isToolkit(toolkit)) return reply({ error: APP_MESSAGES.unknown }, 400);
      if (!connectable(TOOLKITS[toolkit])) return reply({ error: APP_MESSAGES.notYet(appName(toolkit)) }, 400);
      const state = signState(envKeyring(), { ws: wsId, user: who.userId, toolkit });
      const callback = `${appOrigin(request)}/api/apps/composio?${new URLSearchParams({ state })}`;
      const { url } = await connectLink(toolkit, composioUser(wsId), callback);
      return reply({ url });
    }

    // disconnect
    const id = str(body.id, 60);
    const row = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? await removeConnection(db, wsId, id) : null;
    if (!row) return reply({ error: APP_MESSAGES.gone }, 404);
    // Without the key the row is still removed here; the account at Composio can't be reached anyway.
    if (!(await dropAccount(row.composio_account))) log(`Composio account for ${row.toolkit} in workspace ${wsId} wasn't removed at Composio.`);
    return reply({ ok: true });
  } catch (e) {
    log(`Apps ${action} for workspace ${wsId} failed: ${e instanceof Error ? e.message : String(e)}`);
    return reply({ error: APP_MESSAGES.failed }, 502);
  }
}
