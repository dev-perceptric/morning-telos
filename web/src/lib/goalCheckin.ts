// The Monday check-in for one goal: the worker's goal_checkin job (queued by queue_goal_checkins(),
// supabase/023_goals.sql). The goal's owner reads the number from real data where a product gives it, then posts the
// check-in in the goal's chat: the number, what the team did, and the one change for next week. It runs like a
// routine (src/lib/routinesServer.ts): the same turn, tools and AI meter, and it is skipped when the goal is no
// longer active, the owner is paused or can't take work, or the plan or the AI allowance is used up.
// Pure: the database, Claude and the turn come in as deps (src/lib/goalsServer.ts wires the real ones).

import { runTurn as realRunTurn, type LoopClient, type PromptContext, type TeamStore, type TeamWorkspace, type ToolRegistry } from "./agentLoop.ts";
import type { GoalPatch } from "./cardTools.ts";
import type { Metric } from "./cards.ts";
import { applyReading, checkinPrompt, METRIC_SOURCE, type GoalRow } from "./goals.ts";
import type { Handler } from "./jobs.ts";
import { aiBlock, spendWindowStart } from "./meter.ts";
import { AGENTS } from "./team.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CheckinDeps = {
  goal: (workspaceId: string, id: string) => Promise<GoalRow | null>;
  workspace: (workspaceId: string) => Promise<TeamWorkspace | null>;
  store: (workspaceId: string) => TeamStore;
  client: () => LoopClient | null;
  reading: (workspaceId: string, metric: Metric) => Promise<number | null>;
  saveGoal: (workspaceId: string, id: string, patch: GoalPatch) => Promise<void>;
  tools: (workspaceId: string) => ToolRegistry;
  context: (text: string) => PromptContext;
  runTurn?: typeof realRunTurn;
  log?: (message: string) => void;
  now?: () => number;
};

/** The worker's goal_checkin job. Never retried (max_attempts 1): a turn may already have saved work for approval. */
export function checkinHandler(deps: CheckinDeps): Handler {
  return async (job) => {
    const ws = job.workspace_id;
    const id = job.payload.goal;
    if (!ws || typeof id !== "string" || !UUID.test(id)) return { status: "failed", error: "A goal_checkin job needs a workspace and a goal." };
    let g = await deps.goal(ws, id);
    // Done, stopped or deleted since it was queued: nothing to do.
    if (!g || g.status !== "active") return { status: "done" };
    const workspace = await deps.workspace(ws);
    if (!workspace || AGENTS[g.agent].soon) return { status: "done" };
    const store = deps.store(ws);
    const prefs = await store.prefs();
    if (prefs[g.agent]?.enabled === false) return { status: "done" };
    const client = deps.client();
    if (!client) return { status: "done" };
    const now = deps.now?.() ?? Date.now();
    if (aiBlock(workspace, 0, now) ?? aiBlock(workspace, await store.spendSince(spendWindowStart(workspace, now)), now)) return { status: "done" };

    // The number from real data first, so the check-in starts from today's figure.
    if (METRIC_SOURCE[g.metric]) {
      const reading = await deps.reading(ws, g.metric).catch(() => null);
      if (reading !== null) {
        const patch = applyReading(g, reading, { now });
        await deps.saveGoal(ws, g.id, patch);
        g = { ...g, ...patch };
      }
    }
    const text = checkinPrompt(g, now);
    await store.addMessage({ thread_id: g.thread_id, workspace_id: ws, role: "note", agent: g.agent, content: text, meta: { checkin: g.id, week: job.payload.week ?? null } });
    await (deps.runTurn ?? realRunTurn)(
      { workspace, threadId: g.thread_id, text, forced: g.agent },
      { client, store, emit: () => {}, log: deps.log, now: deps.now, tools: deps.tools(ws), context: deps.context(text) },
    );
    return { status: "done" };
  };
}
