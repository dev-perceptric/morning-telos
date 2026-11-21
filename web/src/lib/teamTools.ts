// The AI team's tools on the server: every tool source, put together (toolRegistry.ts), and the database side of
// approvals (supabase/013_approvals.sql). Approvals run through runTeamApproval: Arrowsterr and Capybaroar changes
// through productTools.ts, changes in the customer's own apps through src/lib/composio/appAction.ts, changes on their own WordPress site through src/lib/wordpress/tools.ts. Used by POST /api/chat and POST /api/approvals/:id, and by anything else
// that runs a turn (routines).
//
// To add tools, write a ToolSource (a function from ToolContext to { tools, missing }) and add it to the list in
// teamTools() below. Each source decides which agents get its tools. composeTools runs them all at once, keeps the
// first tool of each name, leaves out a source that fails, and cuts every result to a safe size.
import { leadToolSource, type LeadToolDeps } from "./leadTools.ts";
import { LEAD_COLUMNS, type Lead } from "./leads.ts";
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolRegistry } from "./agentLoop.ts";
import type { Approval, DecideDeps, Decision, NewApproval, RunResult } from "./approvals.ts";
import { cardToolSource, type CardToolDeps } from "./cardTools.ts";
import type { Metric } from "./cards.ts";
import { appToolSource, isAppApproval, runApproval as runAppApproval, type AppToolDeps } from "./composio/appAction.ts";
import { composioOn } from "./composio/composio.ts";
import { connectionsOf, markReconnect } from "./composio/store.ts";
import { activeGoal, approvalFace, pendingIn, planSteps, saveGoal, setStep } from "./goalStore.ts";
import { METRIC_SOURCE, pickMetric } from "./goals.ts";
import { knowledgeToolSource } from "./knowledgeTools.ts";
import { searchKnowledge } from "./knowledgeServer.ts";
import { mcpClient, type McpClient } from "./mcpClient.ts";
import type { Product } from "./partner.ts";
import { mcpUrls, productRead, productToolSource, runApproval as runProductApproval, type ActivityRow, type ProductToolDeps, type ServiceRow } from "./productTools.ts";
import { open } from "./sealing.ts";
import { composeTools, type ToolSource } from "./toolRegistry.ts";
import { wpNet } from "./wordpress/net.ts";
import { markWordpressBroken, wordpressLogin, wordpressSite } from "./wordpress/store.ts";
import { isWordpressApproval, runWordpressApproval, wordpressToolSource, type WpToolDeps } from "./wordpress/tools.ts";
import { passwordAad } from "./wordpress/wordpress.ts";

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

/** What the app tools need on the server: the workspace's connections, Composio from the server's settings, approvals. */
export function appDeps(db: SupabaseClient, log?: (message: string) => void): AppToolDeps {
  const store = approvalStore(db);
  return {
    on: composioOn(),
    connections: (workspaceId) => connectionsOf(db, workspaceId),
    saveApproval: store.save,
    activity: store.activity,
    markReconnect: (workspaceId, toolkit, why) => markReconnect(db, workspaceId, toolkit, why),
    // Self-hosted WordPress counts as a connected site builder (src/lib/wordpress).
    direct: async (workspaceId) => ((await wordpressSite(db, workspaceId)) ? ["wordpress"] : []),
    log,
  };
}

/** What the WordPress tools need on the server: the site and its sealed login, the sealing key, approvals. */
export function wordpressDeps(db: SupabaseClient, log?: (message: string) => void): WpToolDeps {
  const store = approvalStore(db);
  return {
    site: (workspaceId) => wordpressLogin(db, workspaceId),
    openPassword: (sealed, workspaceId) => open(sealed, passwordAad(workspaceId)),
    saveApproval: store.save,
    activity: store.activity,
    markBroken: (workspaceId, why) => markWordpressBroken(db, workspaceId, why),
    net: wpNet(),
    log,
  };
}

/**
 * A goal's raw number from real data: followers or reach from the social results, AI visibility from the SEO data,
 * read with the workspace's own brand key. Null for a metric no product gives, or when it can't be read.
 */
export function goalReading(products: ProductToolDeps): (workspaceId: string, metric: Metric) => Promise<number | null> {
  return async (workspaceId, metric) => {
    const src = METRIC_SOURCE[metric];
    if (!src) return null;
    const answer = await productRead(workspaceId, src.product, src.tool, src.input, products);
    return answer === null ? null : pickMetric(answer, src.keys);
  };
}

/** What the card tools need on the server: approvals, goals and steps, and goal numbers from real data. */
export function cardDeps(db: SupabaseClient, log?: (message: string) => void): CardToolDeps {
  return {
    approval: (ws, id) => approvalFace(db, ws, id),
    activeGoal: (ws, thread) => activeGoal(db, ws, thread),
    planSteps: (ws, thread) => planSteps(db, ws, thread),
    setStep: (ws, id, status) => setStep(db, ws, id, status),
    saveGoal: (ws, id, patch) => saveGoal(db, ws, id, patch),
    reading: goalReading(productDeps(db, log)),
    pending: (ws, thread) => pendingIn(db, ws, thread),
    log,
  };
}

/** Runs an approved change where it belongs: the customer's own app or WordPress site, or Arrowsterr and Capybaroar. */
export function runTeamApproval(db: SupabaseClient, log?: (message: string) => void): (ap: Approval) => Promise<RunResult> {
  const products = productDeps(db, log);
  const apps = appDeps(db, log);
  const wordpress = wordpressDeps(db, log);
  return (ap) => (isWordpressApproval(ap) ? runWordpressApproval(ap, wordpress) : isAppApproval(ap) ? runAppApproval(ap, apps) : runProductApproval(ap, products));
}

/**
 * What decide() (src/lib/approvals.ts) needs for one workspace: the approvals store, the run, and the short note back
 * in the chat. Shared by POST /api/approvals/:id and the Approve link in team emails (src/app/api/email/approve).
 */
export function decideDeps(db: SupabaseClient, ws: string, log: (message: string) => void): DecideDeps {
  const store = approvalStore(db);
  return {
    load: (i) => store.load(ws, i),
    claim: (i, by, d) => store.claim(ws, i, by, d),
    run: runTeamApproval(db, log),
    finish: (i, status, result) => store.finish(ws, i, status, result),
    note: async (ap, text, status) => {
      if (!ap.thread_id) return;
      const { error } = await db.from("messages").insert({ thread_id: ap.thread_id, workspace_id: ws, role: "note", agent: ap.agent, content: text, meta: { approval: ap.id, status } });
      if (error) throw new Error(error.message);
      await db.from("threads").update({ updated_at: new Date().toISOString() }).eq("id", ap.thread_id).eq("workspace_id", ws);
    },
    activity: (ap, text) => store.activity({ workspace_id: ws, agent: ap.agent, thread_id: ap.thread_id, approval_id: ap.id, text }),
    log,
  };
}

/** The leads table for Hermes's tools (028_leads.sql), as the server. Every call is for one workspace. */
export function leadDeps(db: SupabaseClient): LeadToolDeps {
  const num = (l: Lead) => ({ ...l, value: l.value === null ? null : Number(l.value) });
  const one = async (q: PromiseLike<{ data: unknown; error: { message: string } | null }>) => {
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data ? num(data as Lead) : null;
  };
  return {
    async find(ws, q) {
      let query = db.from("leads").select(LEAD_COLUMNS).eq("workspace_id", ws);
      if (q.stage) query = query.eq("stage", q.stage);
      const t = (q.text ?? "").replace(/[%,()*\\]/g, " ").trim();
      if (t) query = query.or(`name.ilike.%${t}%,company.ilike.%${t}%,email.ilike.%${t}%`);
      const { data, error } = await query.order("updated_at", { ascending: false }).limit(q.limit);
      if (error) throw new Error(error.message);
      return ((data ?? []) as Lead[]).map(num);
    },
    byEmail: (ws, email) => one(db.from("leads").select(LEAD_COLUMNS).eq("workspace_id", ws).ilike("email", email.replace(/[%_\\]/g, (c) => `\\${c}`)).maybeSingle()) as Promise<Lead | null>,
    byId: (ws, id) => (/^[0-9a-f-]{36}$/i.test(id) ? (one(db.from("leads").select(LEAD_COLUMNS).eq("workspace_id", ws).eq("id", id).maybeSingle()) as Promise<Lead | null>) : Promise.resolve(null)),
    insert: async (ws, f) => (await one(db.from("leads").insert({ ...f, workspace_id: ws, created_by: null }).select(LEAD_COLUMNS).single())) as Lead,
    update: async (ws, id, f) => (await one(db.from("leads").update({ ...f, updated_at: new Date().toISOString() }).eq("workspace_id", ws).eq("id", id).select(LEAD_COLUMNS).single())) as Lead,
  };
}

/** Every tool source, in order. The first source's tool wins when two share a name. */
export function toolSources(db: SupabaseClient, log?: (message: string) => void): ToolSource[] {
  return [
    // Arrowsterr and Capybaroar through the workspace's brand keys, with approvals.
    productToolSource(productDeps(db, log)),
    // The customer's own apps through Composio (app_search_actions, app_action), with approvals.
    appToolSource(appDeps(db, log)),
    // The customer's own self-hosted WordPress site, called directly, with approvals.
    wordpressToolSource(wordpressDeps(db, log)),
    // search_knowledge for every working agent.
    knowledgeToolSource((ws, q, n) => searchKnowledge(ws, q, n, db)),
    // Answer cards and goals for every working agent (show_card, set_goal, set_plan, update_step, log_progress).
    cardToolSource(cardDeps(db, log)),
    // Hermes's leads list (save_lead, find_leads).
    leadToolSource(leadDeps(db)),
  ];
}

/** The registry the agent loop gets (TurnDeps.tools). */
export function teamTools(db: SupabaseClient, o: { log?: (message: string) => void; extra?: ToolSource[] } = {}): ToolRegistry {
  return composeTools([...toolSources(db, o.log), ...(o.extra ?? [])], { log: o.log });
}
