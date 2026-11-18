// Running routines (src/lib/routines.ts) on the server. Ported from the old app's runRoutine (app/server.js): a chat
// called "Routine: <title>", the instruction as the person's message, then the routine's teammate answers.
//   run_routine      the worker's job handler. queue_routine_runs() (supabase/014_routines_skills_memory.sql) queues
//                    one per routine and scheduled minute. It skips, with a note on the routine, a teammate who is
//                    paused or can't take work, a plan that ended, and an AI allowance that is used up.
//   loadRoutine, startRoutineThread  shared with POST /api/chat, which runs a routine now when someone presses Run now.
// Every query names the workspace (CLAUDE.md: server code checks the workspace too).
import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runTurn, type LoopClient, type ToolRegistry } from "./agentLoop.ts";
import { brainTools, joinTools, teamContext } from "./brainServer.ts";
import type { Handler } from "./jobs.ts";
import { aiBlock, spendWindowStart } from "./meter.ts";
import { routineThreadTitle, SKIP_NOTES, type Routine } from "./routines.ts";
import { isAgentKey, AGENTS } from "./team.ts";
import { isUuid, loadWorkspace, teamStore } from "./teamStore.ts";

export type RoutineRow = Routine & { workspace_id: string; created_by: string | null };

/** One routine in one workspace, or null. */
export async function loadRoutine(db: SupabaseClient, workspaceId: string, id: unknown): Promise<RoutineRow | null> {
  if (!isUuid(id)) return null;
  const { data, error } = await db
    .from("routines")
    .select("id, workspace_id, agent, title, instruction, days, at_time, enabled, last_run_at, last_note, last_thread_id, created_by")
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(/routines/.test(error.message) && /exist|find/.test(error.message) ? "Run supabase/014_routines_skills_memory.sql in Supabase." : `Could not read the routine: ${error.message}`);
  const r = data as RoutineRow | null;
  return r && isAgentKey(r.agent) ? r : null;
}

/** Saves why a scheduled run was skipped, so the Routines page can say it. */
async function note(db: SupabaseClient, r: RoutineRow, text: string) {
  const { error } = await db.from("routines").update({ last_note: text }).eq("id", r.id).eq("workspace_id", r.workspace_id);
  if (error) throw new Error(`Could not save the routine's note: ${error.message}`);
}

/**
 * Makes the routine's chat and posts its instruction as the person's message. `by` is who pressed Run now; a
 * scheduled run belongs to whoever made the routine. Marks the routine as run. Returns the new chat's id.
 */
export async function startRoutineThread(db: SupabaseClient, r: RoutineRow, by: { userId: string | null; email?: string | null; now?: boolean }): Promise<string> {
  const threadId = randomUUID();
  const t = await db.from("threads").insert({ id: threadId, workspace_id: r.workspace_id, title: routineThreadTitle(r.title), created_by: by.userId });
  if (t.error) throw new Error(`Could not start the routine's chat: ${t.error.message}`);
  const meta: Record<string, unknown> = { routine: r.id };
  if (by.email) meta.user = by.email;
  const m = await db.from("messages").insert({ thread_id: threadId, workspace_id: r.workspace_id, role: "user", agent: null, content: r.instruction, meta });
  if (m.error) throw new Error(`Could not post the routine's message: ${m.error.message}`);
  // A scheduled run's last_run_at is its minute, set when it was queued. Run now sets it to now.
  const patch: Record<string, unknown> = { last_note: null, last_thread_id: threadId };
  if (by.now) patch.last_run_at = new Date().toISOString();
  const u = await db.from("routines").update(patch).eq("id", r.id).eq("workspace_id", r.workspace_id);
  if (u.error) throw new Error(`Could not mark the routine as run: ${u.error.message}`);
  return threadId;
}

export type RoutineDeps = {
  client: () => LoopClient | null;
  log: (message: string) => void;
  /** More tools for the teammate (the product tools), joined with use_skill and remember. */
  tools?: (db: SupabaseClient, workspaceId: string) => ToolRegistry;
  now?: () => number;
};

/** The worker's run_routine job. Never retried (max_attempts 1): a turn may already have saved work for approval. */
export function routineJobHandlers(db: SupabaseClient, deps: RoutineDeps): Record<string, Handler> {
  return {
    run_routine: async (job) => {
      const ws = job.workspace_id;
      if (!ws) return { status: "failed", error: "A run_routine job needs a workspace." };
      const r = await loadRoutine(db, ws, job.payload.routine);
      // Deleted or paused since it was queued: nothing to do.
      if (!r || !r.enabled) return { status: "done" };
      const workspace = await loadWorkspace(db, ws);
      if (!workspace) return { status: "done" };
      if (AGENTS[r.agent].soon) {
        await note(db, r, SKIP_NOTES.soon(r.agent));
        return { status: "done" };
      }
      const store = teamStore(db, ws);
      const prefs = await store.prefs();
      if (prefs[r.agent]?.enabled === false) {
        await note(db, r, SKIP_NOTES.paused(r.agent));
        return { status: "done" };
      }
      const client = deps.client();
      if (!client) {
        await note(db, r, SKIP_NOTES.starting);
        return { status: "done" };
      }
      const now = deps.now?.() ?? Date.now();
      const blocked = aiBlock(workspace, 0, now) ?? aiBlock(workspace, await store.spendSince(spendWindowStart(workspace, now)), now);
      if (blocked) {
        await note(db, r, SKIP_NOTES.blocked(blocked.text));
        return { status: "done" };
      }

      const threadId = await startRoutineThread(db, r, { userId: r.created_by });
      const extra = deps.tools?.(db, ws);
      const mine = brainTools(db, ws);
      await runTurn(
        { workspace, threadId, text: r.instruction, forced: r.agent },
        {
          client,
          store,
          // Nobody is watching a scheduled run. The chat is saved as it goes, and opens from Routines or Home.
          emit: () => {},
          log: deps.log,
          now: deps.now,
          tools: extra ? joinTools(mine, extra) : mine,
          context: teamContext(db, { text: r.instruction, log: deps.log }),
        },
      );
      return { status: "done" };
    },
  };
}
