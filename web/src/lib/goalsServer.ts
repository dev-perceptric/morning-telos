// The Monday goal check-in on the server (src/lib/goalCheckin.ts): the worker's goal_checkin job with the real
// database, Claude, tools and the business brain, the same as a routine's run (src/lib/routinesServer.ts).
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LoopClient } from "./agentLoop.ts";
import { brainTools, teamContext } from "./brainServer.ts";
import { checkinHandler } from "./goalCheckin.ts";
import { goalById, saveGoal } from "./goalStore.ts";
import type { Handler } from "./jobs.ts";
import { loadWorkspace, teamStore } from "./teamStore.ts";
import { goalReading, productDeps, teamTools } from "./teamTools.ts";

export function goalJobHandlers(db: SupabaseClient, deps: { client: () => LoopClient | null; log: (message: string) => void; now?: () => number }): Record<string, Handler> {
  return {
    goal_checkin: checkinHandler({
      goal: (ws, id) => goalById(db, ws, id),
      workspace: (ws) => loadWorkspace(db, ws),
      store: (ws) => teamStore(db, ws),
      client: deps.client,
      reading: goalReading(productDeps(db, deps.log)),
      saveGoal: (ws, id, patch) => saveGoal(db, ws, id, patch),
      tools: (ws) => teamTools(db, { log: deps.log, extra: [brainTools(db, ws)] }),
      context: (text) => teamContext(db, { text, log: deps.log }),
      log: deps.log,
      now: deps.now,
    }),
  };
}
