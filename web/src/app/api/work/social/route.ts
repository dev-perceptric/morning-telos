import { routeError } from "@/lib/routeError";
import { adminClient, roleGate } from "@/lib/serverAuth";
import { socialAct, socialPosts } from "@/lib/socialWork";
import { socialData } from "@/lib/socialWorkServer";

// Aphrodite's Posts tab (src/components/Posts.tsx, src/lib/socialWork.ts).
// GET ?workspaceId&from&to: the calendar (viewers and up). POST { workspaceId, action, ... }: create, save or delete a
// post in Capybaroar (editors and up). Waiting posts are approved through /api/approvals/<id>.
export const dynamic = "force-dynamic";
// A product call may take up to 90 seconds (src/lib/mcpClient.ts).
export const maxDuration = 120;

const reply = (out: { status: number; body: Record<string, unknown> }) => Response.json(out.body, { status: out.status, headers: { "Cache-Control": "no-store" } });
const NO_DB = { status: 500, body: { error: "Add SUPABASE_SECRET_KEY to the server's settings." } };

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const ws = q.get("workspaceId");
  const { gate } = roleGate(request, ws);
  const db = adminClient();
  if (!db) return reply(NO_DB);
  try {
    const data = socialData(db, String(ws ?? ""));
    return reply(await socialPosts({ from: q.get("from"), to: q.get("to") }, { gate, ...data }));
  } catch (e) {
    return routeError(e, "social-posts", "We couldn't load your posts. Try again.");
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const { gate } = roleGate(request, body.workspaceId);
  const db = adminClient();
  if (!db) return reply(NO_DB);
  try {
    const data = socialData(db, String(body.workspaceId ?? ""));
    return reply(await socialAct(body, { gate, write: data.write, activity: data.activity }));
  } catch (e) {
    return routeError(e, "social-act", "That didn't save. Try again.");
  }
}
