import { closeWorkspace } from "@/lib/closeoutDb";
import { adminClient, resendSettings, roleGate } from "@/lib/serverAuth";
import { sendMail } from "@/lib/workspaceMail";
import { deleteWorkspace } from "@/lib/workspaceRoutes";
import { routeError } from "@/lib/routeError";

// Delete a whole workspace (owner only). The person types the business name to confirm. Members, invites
// and everything else with this workspace_id go with it (on delete cascade). Sends a goodbye email when Resend is set.
// First its brand keys in Arrowsterr and Capybaroar are revoked and each brand's removal is queued for 30 days later
// (src/lib/closeout.ts). A partner that is down never stops the delete: its revoke is queued and tried again.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const ws = body.workspaceId;
  const { gate, client } = roleGate(request, ws);
  const mail = resendSettings();
  try {
    const out = await deleteWorkspace(body, {
      gate,
      workspaceName: async () => (await client().from("workspaces").select("name").eq("id", ws).maybeSingle()).data?.name ?? null,
      remove: async () => {
        // services and jobs are server only, so closing the brands needs the full-access client.
        const db = adminClient();
        if (!db) throw new Error("Add SUPABASE_SECRET_KEY to the server's settings.");
        await closeWorkspace(db, String(ws));
        const { error } = await db.from("workspaces").delete().eq("id", ws);
        if (error) throw error;
      },
      send: (to, m) => sendMail(mail, to, m),
    });
    return Response.json(out.body, { status: out.status, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return routeError(e, "workspace-delete", "We couldn't delete the workspace. Try again.");
  }
}
