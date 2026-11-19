import * as Sentry from "@sentry/nextjs";
import { randomUUID } from "node:crypto";
import { runTurn, type ChatEvent, type TeamWorkspace } from "@/lib/agentLoop";
import { CHAT_MESSAGES, ndjsonLine, rateLimiter, readChat } from "@/lib/chat";
import { preflight, refuseOtherExtension, withCors } from "@/lib/cors";
import { pageForStore, readPage, readScreenshot } from "@/lib/pageContext";
import { brainTools, teamContext } from "@/lib/brainServer";
import { teamClient } from "@/lib/claude";
import { loadRoutine, startRoutineThread } from "@/lib/routinesServer";
import { adminClient, roleGate } from "@/lib/serverAuth";
import { claudeRouter } from "@/lib/router";
import { lastUserText, loadWorkspace, teamStore, threadInWorkspace, threadTitle } from "@/lib/teamStore";
import { teamTools } from "@/lib/teamTools";
import { LEAD, type AgentKey } from "@/lib/team";
import { NEEDS } from "@/lib/workspace";

// Chat with the AI team (editors and up). Saves the person's message, then streams the turn as NDJSON, one event
// per line: {type:"thread"} first, then route (who answers), status, delta (the reply as it is written), tool,
// handoff and message events, then {type:"done"}. An untagged message goes to the teammate the router picks
// (src/lib/router.ts). Cancelling the request (the Stop button) stops the reply and saves what was written.
// With again (Retry, Ask someone else) the thread's last message from the person is answered again and nothing new
// is saved for the person.
// With routineId (Run now on the Routines page) it starts the routine's own chat instead: "Routine: <title>", the
// routine's instruction as the message, and its teammate answers (src/lib/routinesServer.ts).
// Every teammate gets Knowledge, Memory and its Skills (src/lib/brainServer.ts). A skill picked with /name in the
// message goes into that turn.
// Threads and messages are read by the screen straight from Supabase, where row level security lets every member
// read their own workspace's chats (supabase/011_ai_team.sql). Writes come through here, as the server.
// The Chrome extension calls this too, with its own bearer token, and only its origin gets CORS (src/lib/cors.ts).
// It can send `page` (a web page, an email or selected text) and `screenshot`: the page is saved on the message and
// goes to Claude as outside data, the screenshot only goes with this turn (src/lib/pageContext.ts).
export const dynamic = "force-dynamic";

// 60 messages an hour per workspace, the same as the old app.
const limited = rateLimiter(60, 60 * 60 * 1000);

function log(message: string) {
  console.error(message);
  Sentry.captureMessage(message, { level: "warning", tags: { area: "chat" } });
}

export const OPTIONS = (request: Request) => preflight(request);

export async function POST(request: Request) {
  const refused = refuseOtherExtension(request);
  if (refused) return refused;
  return withCors(request, await chat(request));
}

const fail = (error: string, status: number) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

async function chat(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const workspaceId = body.workspaceId;
  const { gate } = roleGate(request, workspaceId);
  const who = await gate(NEEDS.chat);
  if (!who.ok) return fail(who.error, who.status);
  const ws = workspaceId as string;
  const read = readChat(body);
  if (!read.ok) return fail(read.error, 400);
  const { agent, model, routineId, again } = read.value;
  const page = readPage(body.page);
  if (!page.ok) return fail(page.error, 400);
  const shot = readScreenshot(body.screenshot);
  if (!shot.ok) return fail(shot.error, 400);
  // A screenshot only comes with a page, and never with a routine.
  const screenshot = page.value && !routineId ? shot.value : null;
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
    if (again && threadId) {
      // Retry and Ask someone else answer what the person already sent. Nothing new is saved for them.
      const last = await lastUserText(db, ws, threadId);
      if (!last) return fail(CHAT_MESSAGES.nothingToRetry, 400);
      text = last;
    } else if (routine) {
      text = routine.instruction;
      forced = routine.agent;
      threadId = await startRoutineThread(db, routine, { userId: who.userId, email: who.email ?? who.userId, now: true });
    } else {
      if (!threadId) {
        threadId = randomUUID();
        const { error } = await db.from("threads").insert({ id: threadId, workspace_id: ws, title: threadTitle(text), created_by: who.userId });
        if (error) throw new Error(error.message);
      }
      const { error } = await db.from("messages").insert({ thread_id: threadId, workspace_id: ws, role: "user", agent: null, content: text, meta: { user: who.email ?? who.userId, ...(page.value ? { page: pageForStore(page.value) } : {}) } });
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
  // Stop: the person cancelled the request, so the stream is cancelled (cancel() below). The reply stops and what
  // was written is saved, marked Stopped. request.signal isn't used: it can fire once the response starts.
  const stopped = new AbortController();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: ChatEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(ndjsonLine(e)));
        } catch {
          // Nobody is reading any more: same as Stop.
          open = false;
          stopped.abort();
        }
      };
      emit({ type: "thread", id: thread });
      try {
        // A cancelled request stops the reply. What was written so far is still saved.
        const client = teamClient();
        await runTurn({ workspace: team, threadId: thread, text: words, forced, model, shot: again ? null : screenshot }, {
          client,
          // Picks who answers an untagged message: Claude Haiku 5.5, cut off after 1.5 seconds (then Athena).
          router: client ? claudeRouter(client) : null,
          signal: stopped.signal,
          store: teamStore(db, ws),
          // Arrowsterr and Capybaroar through this workspace's brand keys (changes wait for approval), Knowledge
          // search, and use_skill and remember (src/lib/brainServer.ts).
          tools: teamTools(db, { log, extra: [brainTools(db, ws)] }),
          emit,
          log,
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
      stopped.abort();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
