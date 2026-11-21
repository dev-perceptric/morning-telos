import { appOrigin, resendSettings, roleGate } from "@/lib/serverAuth";
import { sendMail } from "@/lib/workspaceMail";
import { createInvite, type Invite } from "@/lib/workspaceRoutes";
import { routeError } from "@/lib/routeError";

// Invite someone to a workspace by email (admins and the owner). Emails the link through Resend when
// RESEND_API_KEY is set. Either way the answer has the link, so the screen can show it to copy.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const ws = body.workspaceId;
  const { gate, client } = roleGate(request, ws);
  const mail = resendSettings();
  try {
    const out = await createInvite(body, {
      gate,
      origin: appOrigin(request),
      workspaceName: async () => (await client().from("workspaces").select("name").eq("id", ws).maybeSingle()).data?.name ?? null,
      memberEmails: async () => ((await client().from("workspace_members").select("email").eq("workspace_id", ws)).data ?? []).map((m) => String(m.email ?? "")),
      saveInvite: async (row) => {
        // Runs as the caller, so row level security checks they are an admin here too.
        const sb = client();
        const old = await sb.from("workspace_invites").delete().eq("workspace_id", ws).eq("email", row.email).is("accepted_at", null);
        if (old.error) throw old.error;
        const { data, error } = await sb.from("workspace_invites").insert({ workspace_id: ws, ...row }).select("id, email, role, token, expires_at").single();
        if (error) throw error;
        return data as Invite;
      },
      send: (to, m) => sendMail(mail, to, m),
    });
    return Response.json(out.body, { status: out.status, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return routeError(e, "workspace-invite", "We couldn't send the invite. Try again.");
  }
}
