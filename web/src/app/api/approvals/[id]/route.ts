import * as Sentry from "@sentry/nextjs";
import { approvalId, decide, readDecision } from "@/lib/approvals";
import { runApproval } from "@/lib/productTools";
import { adminClient, roleGate } from "@/lib/serverAuth";
import { approvalStore, productDeps } from "@/lib/teamTools";
import { NEEDS } from "@/lib/workspace";

// Approve or deny one change the AI team prepared (editors and up). Body: { workspaceId, action: "approve" | "deny",
// input? }. `input` replaces the saved details when the person edited them. Approving runs the change right away with
// the workspace's brand key, saves the result, and posts a short note back in the chat it came from.
// Approvals are read by the screens straight from Supabase (row level security: members read, supabase/013_approvals.sql).
export const dynamic = "force-dynamic";
// A product call may take up to 90 seconds (src/lib/mcpClient.ts).
export const maxDuration = 120;

function log(message: string) {
  console.error(message);
  Sentry.captureMessage(message, { level: "warning", tags: { area: "approvals" } });
}

const reply = (body: Record<string, unknown>, status: number) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const workspaceId = body.workspaceId;
  const { gate } = roleGate(request, workspaceId);
  const who = await gate(NEEDS.approve);
  if (!who.ok) return reply({ error: who.error }, who.status);
  const ws = workspaceId as string;
  const id = approvalId((await ctx.params).id);
  if (!id) return reply({ error: "That approval was not found." }, 404);
  const read = readDecision(body);
  if (!read.ok) return reply({ error: read.error }, 400);
  const db = adminClient();
  if (!db) return reply({ error: "Add SUPABASE_SECRET_KEY to the server's settings." }, 500);

  const store = approvalStore(db);
  const deps = productDeps(db, log);
  try {
    const out = await decide(id, who.userId, read.value, {
      load: (i) => store.load(ws, i),
      claim: (i, by, d) => store.claim(ws, i, by, d),
      run: (ap) => runApproval(ap, deps),
      finish: (i, status, result) => store.finish(ws, i, status, result),
      note: async (ap, text, status) => {
        if (!ap.thread_id) return;
        const { error } = await db.from("messages").insert({ thread_id: ap.thread_id, workspace_id: ws, role: "note", agent: ap.agent, content: text, meta: { approval: ap.id, status } });
        if (error) throw new Error(error.message);
        await db.from("threads").update({ updated_at: new Date().toISOString() }).eq("id", ap.thread_id).eq("workspace_id", ws);
      },
      activity: (ap, text) => store.activity({ workspace_id: ws, agent: ap.agent, thread_id: ap.thread_id, approval_id: ap.id, text }),
      log,
    });
    return reply(out.body, out.status);
  } catch (e) {
    log(`Approval ${id} in workspace ${ws} failed: ${e instanceof Error ? e.message : String(e)}`);
    return reply({ error: "Something went wrong. Try again." }, 500);
  }
}
