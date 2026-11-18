import * as Sentry from "@sentry/nextjs";
import { APP_MESSAGES } from "@/lib/composio/catalog";
import { envKeyring } from "@/lib/sealing";
import { adminClient, appOrigin, roleGate } from "@/lib/serverAuth";
import { NEEDS } from "@/lib/workspace";
import { startConnect } from "@/lib/wordpress/connect";
import { wpNet } from "@/lib/wordpress/net";
import { removeWordpress } from "@/lib/wordpress/store";
import { WP_MESSAGES } from "@/lib/wordpress/wordpress";

// Settings, Apps: the owner's own WordPress site (src/lib/wordpress). POST { workspaceId, action, ... }, owners and
// admins only:
//   connect     { site }  finds WordPress at the address (https, public addresses only) and answers with the link to
//                         WordPress's own Approve screen. It comes back to GET /api/apps/wordpress/callback.
//   disconnect            removes the site and its login here. The owner can also remove the password in WordPress.
// Members see the connection in POST /api/apps/list and the wordpress_sites table.
export const dynamic = "force-dynamic";

function log(message: string) {
  console.error(message);
  Sentry.captureMessage(message, { level: "warning", tags: { area: "apps" } });
}

const reply = (body: Record<string, unknown>, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = body.action;
  if (action !== "connect" && action !== "disconnect") return reply({ error: "Unknown action." }, 404);
  const { gate } = roleGate(request, body.workspaceId);
  const who = await gate(NEEDS.connectApps);
  if (!who.ok) return reply({ error: who.status === 403 ? APP_MESSAGES.adminsOnly : who.error }, who.status);
  const ws = body.workspaceId as string;
  const db = adminClient();
  if (!db) return reply({ error: "Add SUPABASE_SECRET_KEY to the server's settings." }, 500);

  try {
    if (action === "connect") {
      const out = await startConnect({ ring: envKeyring(), ws, user: who.userId, site: body.site, origin: appOrigin(request), net: wpNet() });
      return out.ok ? reply({ url: out.url }) : reply({ error: out.error }, 400);
    }
    if (!(await removeWordpress(db, ws))) return reply({ error: WP_MESSAGES.gone }, 404);
    return reply({ ok: true, note: WP_MESSAGES.disconnected });
  } catch (e) {
    log(`WordPress ${action} for workspace ${ws} failed: ${e instanceof Error ? e.message : String(e)}`);
    return reply({ error: WP_MESSAGES.failed }, 502);
  }
}
