import { log, failed, reply } from "@/lib/connectRoutes";
import { socialConnectFor } from "@/lib/partner";
import { listNetworks } from "@/lib/partnerConnect";
import { roleGate } from "@/lib/serverAuth";

// GET ?workspaceId=: the social networks owners and admins can connect on our own page (src/lib/partnerConnect.ts),
// or { mode: "link" } while the partner doesn't list them yet.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const ws = new URL(request.url).searchParams.get("workspaceId");
  const { gate } = roleGate(request, ws);
  try {
    return reply(await listNetworks({ gate, social: () => socialConnectFor(process.env, fetch), log }));
  } catch (e) {
    return failed("Networks", e);
  }
}
