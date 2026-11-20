import { failed, reply } from "@/lib/connectRoutes";
import { connectReturn } from "@/lib/partnerConnect";
import { envKeyring } from "@/lib/sealing";
import { roleGate } from "@/lib/serverAuth";

// POST { state, query, workspaceId? }: what /settings/social/return shows after a network's (or SEO tool's) sign-in.
// The sealed state says which product, workspace, person and network; the query is what the partner added
// (cb_status or aw_status, network or integration, reason, pick).
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    return reply(await connectReturn({ state: body.state, query: body.query, workspaceId: body.workspaceId }, { ring: () => envKeyring(), gateFor: (ws) => roleGate(request, ws).gate }));
  } catch (e) {
    return failed("Connect return", e);
  }
}
