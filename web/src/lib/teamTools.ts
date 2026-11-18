// The AI team's tools on the server: every tool source, put together (toolRegistry.ts), and the database side of
// approvals (supabase/013_approvals.sql). Used by POST /api/chat and POST /api/approvals/:id, and by anything else
// that runs a turn (routines).
//
// To add tools, write a ToolSource (a function from ToolContext to { tools, missing }) and add it to the list in
// teamTools() below. Each source decides which agents get its tools. composeTools runs them all at once, keeps the
// first tool of each name, leaves out a source that fails, and cuts every result to a safe size.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolRegistry } from "./agentLoop.ts";
import type { Approval, Decision, NewApproval } from "./approvals.ts";
import { knowledgeToolSource } from "./knowledgeTools.ts";
import { searchKnowledge } from "./knowledgeServer.ts";
import { mcpClient, type McpClient } from "./mcpClient.ts";
import type { Product } from "./partner.ts";
import { mcpUrls, productToolSource, type ActivityRow, type ProductToolDeps, type ServiceRow } from "./productTools.ts";
import { open } from "./sealing.ts";
import { composeTools, type ToolSource } from "./toolRegistry.ts";

// One MCP client for the process, so sessions and tool lists are shared between requests (kept per brand key).
let shared: McpClient | null = null;
const mcp = () => (shared ??= mcpClient({ fetch: (input, init) => fetch(input, init) }));

const must = <T>(r: { data: T; error: { message: string } | null }, what: string): T => {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
};

/** Approvals and activity in the database, with the server's client (adminClient). */
export function approvalStore(db: SupabaseClient) {
  return {
    async save(a: NewApproval): Promise<{ id: number }> {
      const row = must(await db.from("approvals").insert(a).select("id").single(), "Approval wasn't saved") as { id: number };
      return { id: Number(row.id) };
    },
    async activity(row: ActivityRow): Promise<void> {
      must(await db.from("activity").insert(row), "Activity wasn't saved");
    },
    async load(workspaceId: string, id: number): Promise<Approval | null> {
      return must(await db.from("approvals").select("*").eq("id", id).eq("workspace_id", workspaceId).maybeSingle(), "Approval wasn't read") as Approval | null;
    },
    async claim(workspaceId: string, id: number, by: string, d: Decision): Promise<Approval | null> {
      const data = must(await db.rpc("decide_approval", { p_id: id, p_ws: workspaceId, p_by: by, p_action: d.action, p_input: d.action === "approve" ? d.input : null }), "Approval wasn't decided") as Approval[] | Approval | null;
      return (Array.isArray(data) ? data[0] : data) ?? null;
    },
    async finish(workspaceId: string, id: number, status: "done" | "failed", result: string): Promise<void> {
      must(await db.rpc("finish_approval", { p_id: id, p_ws: workspaceId, p_status: status, p_result: result }), "Approval result wasn't saved");
    },
    /** Fails decided calls that never finished. Returns how many. */
    async failStale(older: string): Promise<number> {
      return Number(must(await db.rpc("fail_stale_approvals", { p_older: older }), "Stale approvals weren't checked")) || 0;
    },
  };
}

/** What product tools need on the server: the services rows, the sealing key, the MCP client and approvals. */
export function productDeps(db: SupabaseClient, log?: (message: string) => void): ProductToolDeps {
  const store = approvalStore(db);
  return {
    services: async (workspaceId) => (must(await db.from("services").select("product, status, sealed_key").eq("workspace_id", workspaceId), "Services weren't read") ?? []) as ServiceRow[],
    openKey: (sealed: string, workspaceId: string, product: Product) => open(sealed, `${workspaceId}:${product}`),
    mcp: mcp(),
    urls: mcpUrls({ ARROWSTERR_MCP_URL: process.env.ARROWSTERR_MCP_URL, CAPYBAROAR_MCP_URL: process.env.CAPYBAROAR_MCP_URL }),
    saveApproval: store.save,
    activity: store.activity,
    log,
  };
}

/** Every tool source, in order. The first source's tool wins when two share a name. */
export function toolSources(db: SupabaseClient, log?: (message: string) => void): ToolSource[] {
  return [
    // Arrowsterr and Capybaroar through the workspace's brand keys, with approvals.
    productToolSource(productDeps(db, log)),
    // search_knowledge for every working agent.
    knowledgeToolSource((ws, q, n) => searchKnowledge(ws, q, n, db)),
  ];
}

/** The registry the agent loop gets (TurnDeps.tools). */
export function teamTools(db: SupabaseClient, o: { log?: (message: string) => void; extra?: ToolSource[] } = {}): ToolRegistry {
  return composeTools([...toolSources(db, o.log), ...(o.extra ?? [])], { log: o.log });
}
