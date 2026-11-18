// The AI team's tool registry: a list of tool sources, put together for one agent in one workspace.
// A tool source is anything that, given the agent and workspace (ToolContext), returns that agent's tools and the
// services it should have but can't use right now. Sources: Arrowsterr and Capybaroar through the workspace's brand
// keys (productTools.ts), search_knowledge (knowledgeTools.ts), and later skills, memory and routines.
// The server's list of sources is in teamTools.ts. Pure, so tests compose fake sources.
import type { ToolContext, ToolDef, ToolRegistry, ToolResult, ToolSet } from "./agentLoop.ts";

export type ToolSource = (ctx: ToolContext) => Promise<ToolSet>;

/** What a tool may send back to the model, in letters. Bigger results are cut, saying how much was left out. */
export const MAX_TOOL_RESULT = 16_000;
/** Names Claude accepts for a tool. */
export const TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/;
/** Names the agent loop keeps for itself. */
const RESERVED = new Set(["handoff"]);

/** A result cut to `max` letters. */
export function clipResult(r: ToolResult, max = MAX_TOOL_RESULT): ToolResult {
  const c = String(r.content ?? "");
  return c.length > max ? { ...r, content: `${c.slice(0, max)}\n...(cut: ${(c.length - max).toLocaleString("en-US")} more characters)` } : r;
}

/** A source made of fixed tools, maybe only for some agents. */
export function staticSource(defs: ToolDef[] | ((ctx: ToolContext) => ToolDef[])): ToolSource {
  return async (ctx) => ({ tools: typeof defs === "function" ? defs(ctx) : defs, missing: [] });
}

/**
 * One registry from many sources. Sources run at the same time. A source that fails is left out (and logged) so the
 * others still work. When two tools share a name the first source's wins. Every tool's result is cut to a safe size.
 */
export function composeTools(sources: ToolSource[], o: { log?: (message: string) => void; maxResult?: number } = {}): ToolRegistry {
  return async (ctx) => {
    const sets = await Promise.all(
      sources.map((source, i) =>
        source(ctx).catch((e: unknown): ToolSet => {
          o.log?.(`Tool source ${i + 1} for ${ctx.agent} in workspace ${ctx.workspace.id} failed: ${String((e as Error)?.message ?? e).slice(0, 300)}`);
          return { tools: [], missing: [] };
        }),
      ),
    );
    const tools: ToolDef[] = [];
    const names = new Set<string>();
    const missing: string[] = [];
    for (const set of sets) {
      for (const t of set.tools) {
        const name = t.definition.name;
        if (!TOOL_NAME.test(name) || RESERVED.has(name) || names.has(name)) {
          o.log?.(`Tool "${name}" for ${ctx.agent} was left out: ${names.has(name) ? "another source has that name" : "the name isn't allowed"}.`);
          continue;
        }
        names.add(name);
        tools.push({ ...t, run: async (input, c) => clipResult(await t.run(input, c), o.maxResult) });
      }
      for (const m of set.missing) if (!missing.includes(m)) missing.push(m);
    }
    return { tools, missing };
  };
}
