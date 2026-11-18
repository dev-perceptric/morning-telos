import * as Sentry from "@sentry/nextjs";
import { envKeyring } from "@/lib/sealing";
import { adminClient, appOrigin } from "@/lib/serverAuth";
import { finishConnect } from "@/lib/wordpress/connect";
import { wpNet } from "@/lib/wordpress/net";
import { saveWordpress } from "@/lib/wordpress/store";
import { WP_MESSAGES } from "@/lib/wordpress/wordpress";

// Back from WordPress's own Approve screen (POST /api/apps/wordpress, action connect). WordPress adds site_url,
// user_login and password (the new Application Password) to this address, or success=false when the owner said no.
// The sealed note (state) says which workspace, person and site; it only opens on this server and runs out after 15
// minutes. The person must still be an owner or admin there, the site must be the one asked for, and the login must
// work (one read) before the password is sealed and saved. Then back to Settings, Apps with one line to show.
// The password is never logged: only the workspace and a short reason are.
export const dynamic = "force-dynamic";

function log(message: string) {
  console.error(message);
  Sentry.captureMessage(message, { level: "warning", tags: { area: "apps" } });
}

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const base = appOrigin(request);
  const go = (p: Record<string, string>) => new Response(null, { status: 302, headers: { Location: `${base}/settings/apps?${new URLSearchParams(p)}`, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  const db = adminClient();
  if (!db) return go({ app: "error", reason: WP_MESSAGES.failed });
  try {
    const out = await finishConnect(q, {
      ring: envKeyring(),
      roleOf: async (ws, user) => {
        const { data, error } = await db.from("workspace_members").select("role").eq("workspace_id", ws).eq("user_id", user).maybeSingle();
        if (error) throw new Error(error.message);
        return (data as { role?: string } | null)?.role ?? null;
      },
      save: (row) => saveWordpress(db, row),
      net: wpNet(),
    });
    if (out.ok) return go({ app: "connected", toolkit: "wordpress" });
    return go({ app: "error", reason: out.error });
  } catch (e) {
    log(`Connecting WordPress failed: ${e instanceof Error ? e.message : String(e)}`.slice(0, 400));
    return go({ app: "error", reason: WP_MESSAGES.failed });
  }
}
