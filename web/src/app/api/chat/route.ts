import * as Sentry from "@sentry/nextjs";
import { randomUUID } from "node:crypto";
import { runTurn, type ChatEvent, type TeamWorkspace } from "@/lib/agentLoop";
import { CHAT_MESSAGES, ndjsonLine, rateLimiter, readChat } from "@/lib/chat";
import { knowledgeSection } from "@/lib/knowledge";
import { knowledgeForPrompt } from "@/lib/knowledgeServer";
import { teamClient } from "@/lib/claude";
import { adminClient, roleGate } from "@/lib/serverAuth";
import { loadWorkspace, teamStore, threadInWorkspace, threadTitle } from "@/lib/teamStore";
import { LEAD } from "@/lib/team";
import { NEEDS } from "@/lib/workspace";

// Chat with the AI team (editors and up). Saves the person's message, then streams the turn as NDJSON, one event
// per line: {type:"thread"} first, then status, tool, handoff and message events, then {type:"done"}.
// Threads and messages are read by the screen straight from Supabase, where row level security lets every member
// read their own workspace's chats (supabase/011_ai_team.sql). Writes come through here, as the server.
export const dynamic = "force-dynamic";

// 60 messages an hour per workspace, the same as the old app.
const limited = rateLimiter(60, 60 * 60 * 1000);

function log(message: string) {
  console.error(message);
  Sentry.captureMessage(message, { level: "warning", tags: { area: "chat" } });
}

const fail = (error: string, status: number) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const workspaceId = body.workspaceId;
  const { gate } = roleGate(request, workspaceId);
  const who = await gate(NEEDS.chat);
  if (!who.ok) return fail(who.error, who.status);
  const ws = workspaceId as string;
  const read = readChat(body);
  if (!read.ok) return fail(read.error, 400);
  const { text, agent, model } = read.value;
  const db = adminClient();
  if (!db) return fail("Add SUPABASE_SECRET_KEY to the server's settings.", 500);

  let threadId = read.value.threadId;
  let workspace: TeamWorkspace | null = null;
  try {
    workspace = await loadWorkspace(db, ws);
    if (!workspace) return fail("We couldn't find that workspace.", 404);
    if (threadId && !(await threadInWorkspace(db, ws, threadId))) return fail(CHAT_MESSAGES.badThread, 404);
    if (limited(ws)) return fail(CHAT_MESSAGES.tooMany, 429);
    if (!threadId) {
      threadId = randomUUID();
      const { error } = await db.from("threads").insert({ id: threadId, workspace_id: ws, title: threadTitle(text), created_by: who.userId });
      if (error) throw new Error(error.message);
    }
    const { error } = await db.from("messages").insert({ thread_id: threadId, workspace_id: ws, role: "user", agent: null, content: text, meta: { user: who.email ?? who.userId } });
    if (error) throw new Error(error.message);
  } catch (e) {
    log(`Chat couldn't start in workspace ${ws}: ${e instanceof Error ? e.message : String(e)}`);
    return fail("Something went wrong. Try again.", 500);
  }

  const thread = threadId;
  const team: TeamWorkspace = workspace;
  const encoder = new TextEncoder();
  let open = true;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: ChatEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(ndjsonLine(e)));
        } catch {
          open = false;
        }
      };
      emit({ type: "thread", id: thread });
      try {
        // The turn finishes and is saved even if the person closes the page.
        await runTurn({ workspace: team, threadId: thread, text, forced: agent, model }, {
            client: teamClient(),
            store: teamStore(db, ws),
            emit,
            log,
            // The business brain: this agent's and everyone's docs, as a second cached part of the instructions.
            context: async (key, w) => [knowledgeSection(w.name, await knowledgeForPrompt(w.id, key, 24_000, db))],
          });
      } catch (e) {
        log(`Chat turn failed in workspace ${ws}: ${e instanceof Error ? e.message : String(e)}`);
        emit({ type: "message", agent: LEAD, text: "Something went wrong. Try again in a moment.", error: true });
      }
      emit({ type: "done" });
      if (open) controller.close();
    },
    cancel() {
      open = false;
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
