import * as Sentry from "@sentry/nextjs";
import { randomUUID } from "node:crypto";
import { runTurn, type ChatEvent, type TeamWorkspace } from "@/lib/agentLoop";
import { CHAT_MESSAGES, ndjsonLine, rateLimiter, readChat } from "@/lib/chat";
import { brainTools, teamContext } from "@/lib/brainServer";
import { teamClient } from "@/lib/claude";
import { loadRoutine, startRoutineThread } from "@/lib/routinesServer";
import type { AgentKey } from "@/lib/team";
import { adminClient, roleGate } from "@/lib/serverAuth";
import { loadWorkspace, teamStore, threadInWorkspace, threadTitle } from "@/lib/teamStore";
import { LEAD } from "@/lib/team";
import { NEEDS } from "@/lib/workspace";

// Chat with the AI team (editors and up). Saves the person's message, then streams the turn as NDJSON, one event
// per line: {type:"thread"} first, then status, tool, handoff and message events, then {type:"done"}.
// With routineId (Run now on the Routines page) it starts the routine's own chat instead: "Routine: <title>", the
// routine's instruction as the message, and its teammate answers (src/lib/routinesServer.ts).
// Every teammate gets Knowledge, Memory and its Skills (src/lib/brainServer.ts). A skill picked with /name in the
// message goes into that turn.
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
  const { agent, model, routineId } = read.value;
  let text = read.value.text;
  let forced: AgentKey | null = agent;
  const db = adminClient();
  if (!db) return fail("Add SUPABASE_SECRET_KEY to the server's settings.", 500);

  let threadId = read.value.threadId;
  let workspace: TeamWorkspace | null = null;
  try {
    workspace = await loadWorkspace(db, ws);
    if (!workspace) return fail("We couldn't find that workspace.", 404);
    // A routine always runs in a new chat, so a thread sent with it is ignored.
    if (threadId && !routineId && !(await threadInWorkspace(db, ws, threadId))) return fail(CHAT_MESSAGES.badThread, 404);
    const routine = routineId ? await loadRoutine(db, ws, routineId) : null;
    if (routineId && !routine) return fail(CHAT_MESSAGES.badRoutine, 404);
    if (limited(ws)) return fail(CHAT_MESSAGES.tooMany, 429);
    if (routine) {
      text = routine.instruction;
      forced = routine.agent;
      threadId = await startRoutineThread(db, routine, { userId: who.userId, email: who.email ?? who.userId, now: true });
    } else {
      if (!threadId) {
        threadId = randomUUID();
        const { error } = await db.from("threads").insert({ id: threadId, workspace_id: ws, title: threadTitle(text), created_by: who.userId });
        if (error) throw new Error(error.message);
      }
      const { error } = await db.from("messages").insert({ thread_id: threadId, workspace_id: ws, role: "user", agent: null, content: text, meta: { user: who.email ?? who.userId } });
      if (error) throw new Error(error.message);
    }
  } catch (e) {
    log(`Chat couldn't start in workspace ${ws}: ${e instanceof Error ? e.message : String(e)}`);
    return fail("Something went wrong. Try again.", 500);
  }

  const thread = threadId;
  const team: TeamWorkspace = workspace;
  const words = text;
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
        await runTurn({ workspace: team, threadId: thread, text: words, forced, model }, {
          client: teamClient(),
          store: teamStore(db, ws),
          emit,
          log,
          // use_skill and remember. The product tools join these (src/lib/brainServer.ts joinTools).
          tools: brainTools(db, ws),
          // The business brain: Knowledge, Memory and Skills, as a second cached part of the instructions.
          context: teamContext(db, { text: words, log }),
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
