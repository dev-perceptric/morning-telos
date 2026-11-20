import { failed, log, reply, serviceOf } from "@/lib/connectRoutes";
import { integrationConnectFor } from "@/lib/partner";
import { startIntegration } from "@/lib/partnerConnect";
import { envKeyring } from "@/lib/sealing";
import { appOrigin, roleGate } from "@/lib/serverAuth";

// POST { workspaceId, integration, from }: an SEO tool's own sign-in for the workspace's brand (owners and admins),
// coming back to /settings/social/return with our sealed state and ?aw_status=.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const ws = body.workspaceId;
  const { gate } = roleGate(request, ws);
  try {
    const out = await startIntegration(
      { integration: body.integration, from: body.from },
      {
        gate,
        workspaceId: String(ws ?? ""),
        service: serviceOf(ws, "arrowsterr"),
        tools: () => integrationConnectFor(process.env, fetch),
        ring: () => envKeyring(),
        appOrigin: appOrigin(request),
        log,
      },
    );
    return reply(out);
  } catch (e) {
    return failed("Integration start", e);
  }
}
