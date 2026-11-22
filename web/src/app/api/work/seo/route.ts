import { routeError } from "@/lib/routeError";
import { adminClient, roleGate } from "@/lib/serverAuth";
import { seoAct, seoAnswers, seoWork } from "@/lib/seoWork";
import { seoData } from "@/lib/seoWorkServer";

// Theseus's Visibility tab (src/components/Visibility.tsx, src/lib/seoWork.ts).
// GET ?workspaceId: his questions, content plan and line (viewers and up), from a copy read at most once a day.
// GET ?workspaceId&prompt: each AI tool's latest answer to one question.
// POST { workspaceId, action, ... }: track a question, or add, move or remove a topic (editors and up).
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
    const data = seoData(db, String(ws ?? ""));
    if (q.has("prompt")) return reply(await seoAnswers(q.get("prompt"), { gate, read: data.read }));
    return reply(await seoWork({ gate, ...data }));
  } catch (e) {
    return routeError(e, "seo-work", "We couldn't load Theseus's work. Try again.");
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const { gate } = roleGate(request, body.workspaceId);
  const db = adminClient();
  if (!db) return reply(NO_DB);
  try {
    const data = seoData(db, String(body.workspaceId ?? ""));
    return reply(await seoAct(body, { gate, write: data.write, tracked: data.tracked, limit: data.limit, clearCache: data.cache.clear, activity: data.activity }));
  } catch (e) {
    return routeError(e, "seo-act", "That didn't save. Try again.");
  }
}
