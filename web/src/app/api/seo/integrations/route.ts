import { failed, log, reply } from "@/lib/connectRoutes";
import { integrationConnectFor } from "@/lib/partner";
import { listIntegrations } from "@/lib/partnerConnect";
import { roleGate } from "@/lib/serverAuth";

// GET ?workspaceId=: the SEO tools owners and admins can connect on our own page, or { mode: "off" } while the
// partner doesn't list any. No screen uses it until there is a list.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const ws = new URL(request.url).searchParams.get("workspaceId");
  const { gate } = roleGate(request, ws);
  try {
    return reply(await listIntegrations({ gate, tools: () => integrationConnectFor(process.env, fetch), log }));
  } catch (e) {
    return failed("Integrations", e);
  }
}
