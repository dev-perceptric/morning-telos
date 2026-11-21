import { partnerFor } from "@/lib/partner";
import { routeError } from "@/lib/routeError";
import { adminClient, roleGate } from "@/lib/serverAuth";
import { disconnectSocial } from "@/lib/socialWork";
import { log, socialData } from "@/lib/socialWorkServer";

// POST { workspaceId, channelId }: disconnects one social account through Capybaroar's partner API (owners and admins).
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const { gate } = roleGate(request, body.workspaceId);
  const db = adminClient();
  if (!db) return Response.json({ error: "Add SUPABASE_SECRET_KEY to the server's settings." }, { status: 500 });
  try {
    const data = socialData(db, String(body.workspaceId ?? ""));
    const out = await disconnectSocial(body, { gate, ...data, partner: () => partnerFor("capybaroar", process.env, fetch), log });
    return Response.json(out.body, { status: out.status, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return routeError(e, "social-disconnect", "We couldn't disconnect that account. Try again.");
  }
}
