import { failed, log, reply } from "@/lib/connectRoutes";
import { socialConnectFor } from "@/lib/partner";
import { pickOptions, pickSave } from "@/lib/partnerConnect";
import { envKeyring } from "@/lib/sealing";
import { roleGate } from "@/lib/serverAuth";

// The pick step after a network sign-in (which Facebook Pages, which LinkedIn pages). Both need our sealed state from
// the return address, and the signed-in person must be the owner or admin who started it.
//   GET  ?state=&workspaceId=           the pages and accounts to choose from
//   POST { state, workspaceId, ids }    connect the picked ones
export const dynamic = "force-dynamic";

const deps = (request: Request) => ({
  ring: () => envKeyring(),
  gateFor: (ws: string) => roleGate(request, ws).gate,
  social: () => socialConnectFor(process.env, fetch),
  log,
});

export async function GET(request: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const q = new URL(request.url).searchParams;
  try {
    return reply(await pickOptions(token, { state: q.get("state"), workspaceId: q.get("workspaceId") }, deps(request)));
  } catch (e) {
    return failed("Pick", e);
  }
}

export async function POST(request: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    return reply(await pickSave(token, { state: body.state, workspaceId: body.workspaceId, ids: body.ids }, deps(request)));
  } catch (e) {
    return failed("Pick connect", e);
  }
}
