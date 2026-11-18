// What every teammate knows and can do beyond its product tools, for POST /api/chat and the routine worker:
//   teamContext  the cached system sections: Knowledge, Memory and the Skills list, plus a skill picked with /.
//   brainTools   the use_skill and remember tools (src/lib/skillTool.ts, src/lib/rememberTool.ts), a tool source
//                that teamTools (src/lib/teamTools.ts) puts with the product tools.
// Both read one workspace with the server's client, so every query names the workspace (CLAUDE.md: server code checks
// the workspace too). A part that can't load (a table before its migration runs, a hiccup) is left out, so the
// teammate still answers.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PromptContext } from "./agentLoop.ts";
import { knowledgeSection } from "./knowledge.ts";
import { knowledgeForPrompt } from "./knowledgeServer.ts";
import { MAX_MEMORIES, memorySection, type Memory } from "./memory.ts";
import { rememberTool, type MemoryStore } from "./rememberTool.ts";
import { pickedSkill, pickedSkillPrompt, skillCatalog, skillsFor, type SkillRow } from "./skills.ts";
import { skillTool } from "./skillTool.ts";
import { isAgentKey, type AgentKey } from "./team.ts";
import type { ToolSource } from "./toolRegistry.ts";

/** How much of the prompt Knowledge may use (the same as before memory and skills came). */
export const KNOWLEDGE_BUDGET = 24_000;

type Log = (message: string) => void;
const why = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 300);

/** The workspace's own skills (supabase/014_routines_skills_memory.sql). */
export async function skillRows(db: SupabaseClient, workspaceId: string): Promise<SkillRow[]> {
  const { data, error } = await db.from("skills").select("id, agent, name, description, body, updated_at").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(100);
  if (error) throw new Error(`Could not read skills: ${error.message}`);
  return (data ?? []) as SkillRow[];
}

/** The workspace's saved facts, newest first. */
export async function memoryRows(db: SupabaseClient, workspaceId: string): Promise<Memory[]> {
  const { data, error } = await db.from("memories").select("id, agent, fact, thread_id, created_at").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(MAX_MEMORIES);
  if (error) throw new Error(`Could not read memory: ${error.message}`);
  return ((data ?? []) as (Omit<Memory, "agent"> & { agent: string | null })[]).map((m) => ({ ...m, agent: isAgentKey(m.agent) ? m.agent : null }));
}

/** The memories table for one workspace, for the remember tool. */
export function memoryStore(db: SupabaseClient, workspaceId: string): MemoryStore {
  return {
    list: () => memoryRows(db, workspaceId),
    async add(row) {
      const { error } = await db.from("memories").insert({ workspace_id: workspaceId, ...row });
      if (error?.code === "23505") return false;
      if (error) throw new Error(/Memory is full/.test(error.message) ? error.message : `Could not save to memory: ${error.message}`);
      return true;
    },
    async replace(id, row) {
      const { error } = await db.from("memories").update({ ...row, created_at: new Date().toISOString() }).eq("id", id).eq("workspace_id", workspaceId);
      if (error) throw new Error(`Could not update memory: ${error.message}`);
    },
  };
}

/**
 * The teammate's extra system sections, in an order that keeps the cache: Knowledge, Memory and the Skills list
 * change only when someone edits them; a skill picked with /name in `text` comes last, for this turn only.
 */
export function teamContext(db: SupabaseClient, o: { text?: string; log?: Log } = {}): PromptContext {
  let rows: Promise<SkillRow[]> | null = null;
  return async (key: AgentKey, w) => {
    const part = async (name: string, fn: () => Promise<string>) => {
      try {
        return await fn();
      } catch (e) {
        o.log?.(`${name} for ${key} in workspace ${w.id} left out: ${why(e)}`);
        return "";
      }
    };
    rows ??= skillRows(db, w.id);
    const skills = await rows.then((r) => skillsFor(key, r)).catch((e) => {
      o.log?.(`Skills for ${key} in workspace ${w.id} left out: ${why(e)}`);
      return skillsFor(key, []);
    });
    const picked = o.text ? pickedSkill(o.text, skills) : null;
    const parts = [
      await part("Knowledge", async () => knowledgeSection(w.name, await knowledgeForPrompt(w.id, key, KNOWLEDGE_BUDGET, db))),
      await part("Memory", async () => memorySection(await memoryRows(db, w.id), key)),
      skillCatalog(skills),
      picked ? pickedSkillPrompt(picked) : "",
    ];
    return parts.filter(Boolean);
  };
}

/** use_skill (when the teammate has skills) and remember, for one workspace. A tool source for teamTools (src/lib/teamTools.ts). */
export function brainTools(db: SupabaseClient, workspaceId: string): ToolSource {
  let rows: Promise<SkillRow[]> | null = null;
  const load = (agent: AgentKey) => {
    rows ??= skillRows(db, workspaceId);
    return rows.then((r) => skillsFor(agent, r));
  };
  return async (ctx) => {
    if (ctx.workspace.id !== workspaceId) throw new Error("These tools are for another workspace.");
    const has = await load(ctx.agent).then((s) => s.length > 0).catch(() => false);
    return { tools: [...(has ? [skillTool(load)] : []), rememberTool(memoryStore(db, workspaceId))], missing: [] };
  };
}
