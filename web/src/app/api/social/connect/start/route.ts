import { failed, log, reply, serviceOf } from "@/lib/connectRoutes";
import { partnerFor, socialConnectFor } from "@/lib/partner";
import { startConnect } from "@/lib/partnerConnect";
import { envKeyring } from "@/lib/sealing";
import { appOrigin, roleGate } from "@/lib/serverAuth";

// POST { workspaceId, network, from }: the network's own sign-in for the workspace's brand (owners and admins). It
// comes back to /settings/social/return with our sealed state. { mode: "link" } is the old connect page instead.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const ws = body.workspaceId;
  const { gate } = roleGate(request, ws);
  try {
    const out = await startConnect(
      { network: body.network, from: body.from },
      {
        gate,
        workspaceId: String(ws ?? ""),
        service: serviceOf(ws, "capybaroar"),
        social: () => socialConnectFor(process.env, fetch),
        partner: () => partnerFor("capybaroar", process.env, fetch),
        ring: () => envKeyring(),
        appOrigin: appOrigin(request),
        log,
      },
    );
    return reply(out);
  } catch (e) {
    return failed("Connect start", e);
  }
}
