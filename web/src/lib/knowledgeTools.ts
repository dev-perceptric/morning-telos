// search_knowledge: every working agent can look up the business's own facts in Knowledge (supabase/012_knowledge.sql)
// when the docs in its prompt don't cover the question. Reads only. Pure: the search comes in (knowledgeServer.ts
// searchKnowledge on the server), and it always searches the agent's own workspace.
import type { ToolDef } from "./agentLoop.ts";
import type { ToolSource } from "./toolRegistry.ts";
import { AGENTS } from "./team.ts";

export type KnowledgeSearch = (workspaceId: string, query: string, limit: number) => Promise<{ title: string; snippet: string }[]>;

export const SEARCH_KNOWLEDGE = "search_knowledge";

export function knowledgeTool(search: KnowledgeSearch): ToolDef {
  return {
    definition: {
      name: SEARCH_KNOWLEDGE,
      description: "Search this business's Knowledge (services, prices, area, tone, notes the team added) for facts. Use it before saying you don't know a fact about the business.",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "A few words to look for, like \"wedding cake prices\"." },
          limit: { type: "integer", minimum: 1, maximum: 20, description: "How many matches to return. Default 8." },
        },
        required: ["query"],
      },
    },
    label: "Searching Knowledge",
    async run(input, ctx) {
      const query = typeof input.query === "string" ? input.query.trim() : "";
      if (!query) return { content: "Give a few words to search for.", isError: true };
      const n = Math.max(1, Math.min(Math.floor(Number(input.limit)) || 8, 20));
      const hits = await search(ctx.workspace.id, query, n);
      if (!hits.length) return { content: `Nothing in Knowledge matches "${query.slice(0, 200)}".` };
      return { content: hits.map((h, i) => `${i + 1}. ${h.title}\n${h.snippet}`).join("\n\n") };
    },
  };
}

/** search_knowledge for every teammate who can take work. */
export function knowledgeToolSource(search: KnowledgeSearch): ToolSource {
  const tool = knowledgeTool(search);
  return async (ctx) => ({ tools: AGENTS[ctx.agent]?.soon ? [] : [tool], missing: [] });
}
