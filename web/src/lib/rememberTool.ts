// The remember tool: a teammate saves one short, lasting fact about the business (src/lib/memory.ts). Deduped, at
// most 500 characters and 200 facts per workspace, and never a secret. It only writes inside Morning Telos, so it
// needs no approval. A standalone AgentTool (src/lib/agentLoop.ts): the database comes in as a MemoryStore.
import type { AgentTool } from "./agentLoop.ts";
import { MEMORY_MESSAGES, planRemember, REMEMBER, type Memory } from "./memory.ts";
import type { AgentKey } from "./team.ts";

/** The memories table, already bound to one workspace. The server's version is in brainServer.ts. */
export type MemoryStore = {
  /** Every saved fact in the workspace (at most 200). */
  list: () => Promise<Pick<Memory, "id" | "fact">[]>;
  /** Returns false when the same fact was saved at the same moment (the unique index said so). */
  add: (row: { agent: AgentKey | null; fact: string; thread_id: string | null }) => Promise<boolean>;
  replace: (id: string, row: { fact: string; thread_id: string | null }) => Promise<void>;
};

export function rememberTool(store: MemoryStore): AgentTool {
  return {
    definition: REMEMBER,
    label: "Saving to memory",
    async run(input, ctx) {
      const plan = planRemember(await store.list(), input.fact);
      if (plan.action === "refuse") return { content: plan.reason, isError: true };
      if (plan.action === "same") return { content: MEMORY_MESSAGES.same };
      if (plan.action === "replace") {
        await store.replace(plan.id, { fact: plan.fact, thread_id: ctx.threadId });
        return { content: MEMORY_MESSAGES.updated };
      }
      const added = await store.add({ agent: input.just_me === true ? ctx.agent : null, fact: plan.fact, thread_id: ctx.threadId });
      return { content: added ? MEMORY_MESSAGES.saved : MEMORY_MESSAGES.same };
    },
  };
}
