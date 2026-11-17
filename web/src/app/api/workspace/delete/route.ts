import { adminClient, resendSettings, roleGate } from "@/lib/serverAuth";
import { sendMail } from "@/lib/workspaceMail";
import { deleteWorkspace } from "@/lib/workspaceRoutes";

// Delete a whole workspace (owner only). The person types the business name to confirm. Members, invites
// and everything else with this workspace_id go with it (on delete cascade). Sends a goodbye email when Resend is set.
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
        // The full-access client when it's set up. Without it, the owner's own client works too (row level security lets the owner delete).
        const db = adminClient() ?? client();
        const { error } = await db.from("workspaces").delete().eq("id", ws);
        if (error) throw error;
      },
      send: (to, m) => sendMail(mail, to, m),
    });
    return Response.json(out.body, { status: out.status, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Something went wrong. Try again." }, { status: 500 });
  }
}
