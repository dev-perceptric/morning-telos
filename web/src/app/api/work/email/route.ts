import { inboxOf, log, senderOf, sendOne } from "@/lib/campaignSendServer";
import { appUrl } from "@/lib/emailKit";
import { emailAct } from "@/lib/emailWork";
import { routeError } from "@/lib/routeError";
import { adminClient, roleGate } from "@/lib/serverAuth";

// Cyrus's Campaigns tab (src/components/Campaigns.tsx, src/lib/emailWork.ts).
// POST { workspaceId, action: "schedule" | "test", campaignId, sendAt? } (editors and up).
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const ws = String(body.workspaceId ?? "");
  const { gate } = roleGate(request, body.workspaceId);
  const db = adminClient();
  if (!db) return Response.json({ error: "Add SUPABASE_SECRET_KEY to the server's settings." }, { status: 500 });
  try {
    const out = await emailAct(body, {
      gate,
      campaign: async (id) => {
        const { data, error } = await db.from("campaigns").select("id, subject, body, list, status").eq("workspace_id", ws).eq("id", id).maybeSingle();
        if (error) throw new Error(error.message);
        return data as Awaited<ReturnType<Parameters<typeof emailAct>[1]["campaign"]>>;
      },
      sender: () => senderOf(db, ws),
      inbox: () => inboxOf(db, ws),
      reachable: async (list) => {
        let q = db.from("contacts").select("id", { count: "exact", head: true }).eq("workspace_id", ws).is("unsubscribed_at", null);
        if (list) q = q.eq("list", list);
        const { count, error } = await q;
        if (error) throw new Error(error.message);
        return count ?? 0;
      },
      schedule: async (id, patch) => {
        const { error } = await db.from("campaigns").update({ ...patch, updated_at: new Date().toISOString() }).eq("workspace_id", ws).eq("id", id).eq("status", "draft");
        if (error) throw new Error(error.message);
      },
      send: (app, to, subject, text) => sendOne(db, ws, app, to, subject, text),
      unsubscribeUrl: `${appUrl()}/api/unsubscribe`,
      activity: async (text) => {
        const { error } = await db.from("activity").insert({ workspace_id: ws, agent: "email", text });
        if (error) log(`Activity wasn't saved: ${error.message}`);
      },
    });
    return Response.json(out.body, { status: out.status, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return routeError(e, "email-act", "That didn't work. Try again.");
  }
}
