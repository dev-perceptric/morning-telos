import { formsAct, formsMeetings } from "@/lib/formsWork";
import { formsData } from "@/lib/formsWorkServer";
import { routeError } from "@/lib/routeError";
import { adminClient, roleGate } from "@/lib/serverAuth";

// Hora's Calendar tab (src/components/Meetings.tsx, src/lib/formsWork.ts).
// GET ?workspaceId&from&to: meetings from Google Calendar or Calendly, and Hora's waiting invites (viewers and up).
// POST { workspaceId, action: "cancel" | "move", source, id, start?, end? }: the person's own change (editors and up).
export const dynamic = "force-dynamic";
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
    return reply(await formsMeetings({ from: q.get("from"), to: q.get("to") }, { gate, ...formsData(db, String(ws ?? "")) }));
  } catch (e) {
    return routeError(e, "forms-meetings", "We couldn't load your calendar. Try again.");
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const { gate } = roleGate(request, body.workspaceId);
  const db = adminClient();
  if (!db) return reply(NO_DB);
  try {
    const data = formsData(db, String(body.workspaceId ?? ""));
    return reply(await formsAct(body, { gate, run: data.run, activity: data.activity }));
  } catch (e) {
    return routeError(e, "forms-act", "That didn't save. Try again.");
  }
}
