// What the agent loop reads from Knowledge (supabase/012_knowledge.sql). Server only.
//   knowledgeForPrompt: the docs for one agent, as text for its system prompt, within a size budget.
//   searchKnowledge: the best matching docs for a question, for a search_knowledge tool.
// Both take the workspace id and only ever read that workspace. With the service client (the default) row level
// security is skipped, so the workspace filter here and in search_knowledge() is what keeps customers apart. Pass the
// caller's own client instead to read as them.
// searchKnowledge's shape stays the same when embeddings are added (Omniscient's src/lib/search/query.ts: Voyage
// vectors merged with the word matches), so callers won't change.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildKnowledgePrompt, type KnowledgeDoc } from "./knowledge.ts";
import { adminClient } from "./serverAuth.ts";

export type KnowledgeHit = { id: string; title: string; snippet: string; rank: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function client(db?: SupabaseClient | null): SupabaseClient {
  const c = db ?? adminClient();
  if (!c) throw new Error("Add SUPABASE_SECRET_KEY to the server's settings.");
  return c;
}

/**
 * The knowledge block for one agent's system prompt: the website doc, then docs for this agent, then docs for
 * everyone, newest first, whole docs while they fit in `budgetChars` (see buildKnowledgePrompt). Docs for other
 * agents are left out. Returns a short "nothing added yet" line when there are none.
 */
export async function knowledgeForPrompt(workspaceId: string, agentKey: string, budgetChars: number, db?: SupabaseClient | null): Promise<string> {
  if (!UUID.test(workspaceId)) throw new Error("Missing workspace.");
  const { data, error } = await client(db)
    .from("knowledge_docs")
    .select("title, body, agent, source, updated_at")
    .eq("workspace_id", workspaceId)
    .or(`agent.is.null,agent.eq.${agentKey.replace(/[^a-z0-9_]/g, "")}`)
    .order("updated_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(/knowledge_docs/.test(error.message) ? "Run supabase/012_knowledge.sql in Supabase." : `Could not read Knowledge: ${error.message}`);
  return buildKnowledgePrompt((data ?? []) as Pick<KnowledgeDoc, "title" | "body" | "agent" | "source" | "updated_at">[], agentKey, budgetChars);
}

/** The best matching docs for a question in one workspace, best first (at most 20). An empty question finds nothing. */
export async function searchKnowledge(workspaceId: string, query: string, limit = 8, db?: SupabaseClient | null): Promise<KnowledgeHit[]> {
  if (!UUID.test(workspaceId)) throw new Error("Missing workspace.");
  const q = String(query ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
  if (!q) return [];
  const n = Math.max(1, Math.min(Math.floor(limit) || 8, 20));
  const { data, error } = await client(db).rpc("search_knowledge", { ws: workspaceId, q, n });
  if (error) throw new Error(/search_knowledge/.test(error.message) ? "Run supabase/012_knowledge.sql in Supabase." : `Could not search Knowledge: ${error.message}`);
  return ((data ?? []) as KnowledgeHit[]).map((h) => ({ id: h.id, title: h.title, snippet: h.snippet, rank: Number(h.rank) }));
}
