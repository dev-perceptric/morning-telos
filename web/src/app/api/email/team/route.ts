import { roleGate } from "@/lib/serverAuth";
import { teamEmailDomain } from "@/lib/teamEmail";
import { NEEDS } from "@/lib/workspace";

// Whether the email door is on for this server, for Settings > General: { domain } with TEAM_EMAIL_DOMAIN, or
// { domain: null } while it is empty (the section stays hidden). Any member may ask. The address itself is read from
// Supabase by the screen (team_email, supabase/023_team_email.sql).
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const { gate } = roleGate(request, body.workspaceId);
  const who = await gate(NEEDS.viewSettings);
  if (!who.ok) return Response.json({ error: who.error }, { status: who.status, headers: { "Cache-Control": "no-store" } });
  return Response.json({ domain: teamEmailDomain(process.env) }, { headers: { "Cache-Control": "no-store" } });
}
