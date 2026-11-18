// The AI team's tools in Arrowsterr and Capybaroar, through each workspace's own brand key.
// Ported from the old app's buildTools and executeApproval (app/lib/agents.js). The old app shared one key for every
// customer, so a gateway (SCOPE) rewrote each call to the customer's brand. A brand key sees only its own brand (the
// products check it before any tool runs), so the gateway is gone. What stays:
//   - which agent may use which app (AGENTS[k].apps in team.ts: social on Capybaroar, seo and web on Arrowsterr,
//     Athena on every app, reads only),
//   - reads run, changes (isWrite in approvals.ts) are saved for approval unless the agent is on autopilot,
//   - an approved change runs only after checking it is still allowed, and every change is logged in activity.
//
// The brand key is opened here, on the server, only to call the product. It is never put in a tool definition, a
// prompt, a result, an approval or a log. Pure: the database, the sealing key and the MCP client come in as deps.
import type { ToolContext, ToolDef, Trust } from "./agentLoop.ts";
import { APPROVAL_MESSAGES, isWrite, toolTitle, type Approval, type NewApproval, type RunResult } from "./approvals.ts";
import type { McpClient, McpServer, McpTool } from "./mcpClient.ts";
import { PRODUCTS, type Product } from "./partner.ts";
import type { ToolSource } from "./toolRegistry.ts";
import { AGENTS, type AgentKey } from "./team.ts";

/** What each product does for the customer, as the agents and the screens say it. */
export const PRODUCT_LABEL: Record<Product, string> = { arrowsterr: "SEO and AI visibility", capybaroar: "Social media" };
const PRODUCT_WHY: Record<Product, string> = {
  arrowsterr: "This changes your SEO work, like the content plan or the AI questions we track.",
  capybaroar: "This changes your social media, like posts, drafts or media.",
};

/** The products' MCP servers. ARROWSTERR_MCP_URL and CAPYBAROAR_MCP_URL change them (a test server, say). */
export const MCP_DEFAULTS: Record<Product, string> = { arrowsterr: "https://app.arrowsterr.com/api/mcp", capybaroar: "https://app.capybaroar.com/api/mcp" };
export function mcpUrls(env: Record<string, string | undefined>): Record<Product, string> {
  const pick = (v: string | undefined, d: string) => {
    const s = v?.trim().replace(/\/+$/, "");
    return s && /^https?:\/\/[^\s/]+/.test(s) ? s : d;
  };
  return { arrowsterr: pick(env.ARROWSTERR_MCP_URL, MCP_DEFAULTS.arrowsterr), capybaroar: pick(env.CAPYBAROAR_MCP_URL, MCP_DEFAULTS.capybaroar) };
}

/**
 * Tools agents never get. Capybaroar's webhooks are refused to brand keys anyway (and could send data anywhere), and
 * its credits are Morning Telos's own account, not the customer's.
 */
export const HIDDEN: Record<Product, ReadonlySet<string>> = {
  arrowsterr: new Set(),
  capybaroar: new Set(["list_webhooks", "create_webhook", "set_webhook", "delete_webhook", "test_webhook", "get_credits"]),
};

/** The products an agent works through. "*" is every product. */
export function productsFor(agent: AgentKey): Product[] {
  const a = AGENTS[agent];
  if (!a || a.soon) return [];
  return a.apps.includes("*") ? [...PRODUCTS] : PRODUCTS.filter((p) => a.apps.includes(p));
}

/** Why a product can't be used right now, for the agent's prompt ("Not available right now: ..."). */
export function missingReason(product: Product, status: string | null): string {
  const l = PRODUCT_LABEL[product];
  if (status === "waiting") return `${l} (turns on once the business adds its website in Settings)`;
  if (status === "failed") return `${l} (setup hit a problem, and Morning Telos is fixing it)`;
  if (status === "removing" || status === "removed") return `${l} (turned off for this business)`;
  if (status === "unavailable") return `${l} (temporarily unavailable)`;
  return `${l} (still being set up for this business)`;
}

/** What a person reads when an approved change can't run. */
export function blockedText(product: Product, status: string | null): string {
  if (status === "waiting") return "This turns on once you add your website in Settings.";
  if (status === "removing" || status === "removed") return "This is turned off for your business.";
  if (status === "unavailable") return "We couldn't reach this service right now. Try again in a few minutes.";
  return "This service isn't set up for your business yet.";
}

/** A product tool's name for Claude: "arrowsterr__get_ai_visibility". */
export const toolName = (product: Product, name: string) => `${product}__${name}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);

/** The tool's input schema as Claude takes it: an object schema, without the $schema line. */
function schemaOf(t: McpTool): ToolDef["definition"]["input_schema"] {
  const s = t.inputSchema;
  if (!s || typeof s !== "object" || s.type !== "object") return { type: "object", properties: {} };
  const { $schema: _drop, ...rest } = s as Record<string, unknown>;
  void _drop;
  return rest as ToolDef["definition"]["input_schema"];
}

export type ServiceRow = { product: Product; status: string; sealed_key: string | null };
export type ActivityRow = { workspace_id: string; agent: AgentKey; thread_id: string | null; approval_id: number | null; text: string };
export type ProductToolDeps = {
  /** The workspace's services rows (server only: they hold the sealed keys). */
  services: (workspaceId: string) => Promise<ServiceRow[]>;
  /** Opens a sealed brand key. The AAD binds it to the workspace and product (sealing.ts). */
  openKey: (sealed: string, workspaceId: string, product: Product) => string;
  mcp: McpClient;
  urls: Record<Product, string>;
  saveApproval: (a: NewApproval) => Promise<{ id: number }>;
  activity: (row: ActivityRow) => Promise<void>;
  log?: (message: string) => void;
};

const errText = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 300);

type Connected = { ok: true; server: McpServer; tools: McpTool[] } | { ok: false; status: string | null };

/** The product's server with the workspace's brand key, and its tools. A reason when it can't be used. */
async function connect(product: Product, workspaceId: string, rows: ServiceRow[], deps: ProductToolDeps): Promise<Connected> {
  const row = rows.find((r) => r.product === product);
  if (!row || row.status !== "ready" || !row.sealed_key) return { ok: false, status: row && row.status !== "ready" ? row.status : null };
  let key: string;
  try {
    key = deps.openKey(row.sealed_key, workspaceId, product);
  } catch (e) {
    deps.log?.(`The ${product} brand key for workspace ${workspaceId} couldn't be opened: ${errText(e)}`);
    return { ok: false, status: "unavailable" };
  }
  const server = { url: deps.urls[product], key };
  try {
    return { ok: true, server, tools: await deps.mcp.listTools(server) };
  } catch (e) {
    deps.log?.(`${product} tools for workspace ${workspaceId} couldn't be listed: ${errText(e)}`);
    return { ok: false, status: "unavailable" };
  }
}

const autopilot = (trust: Trust) => trust >= 2;

/** One product tool for an agent. Reads run; changes are saved for approval below autopilot, and logged. */
function productTool(product: Product, t: McpTool, server: McpServer, write: boolean, ctx: ToolContext, deps: ProductToolDeps): ToolDef {
  const label = PRODUCT_LABEL[product];
  const nice = toolTitle(t.name, t.title ?? t.annotations?.title);
  const title = `${nice} (${label})`;
  const description = (t.description || t.title || t.name).replace(/\s+/g, " ").trim().slice(0, 1000);
  return {
    definition: { name: toolName(product, t.name), description: `[${label}${write ? ", changes something" : ""}] ${description}`, input_schema: schemaOf(t) },
    label: `${label}: ${nice.toLowerCase()}`,
    write,
    async run(input, c) {
      // A registry is made for one workspace and agent. Never let a tool run for another.
      if (c.workspace.id !== ctx.workspace.id || c.agent !== ctx.agent) return { content: "That tool isn't available.", isError: true };
      if (write && !autopilot(c.trust)) {
        const ap = await deps.saveApproval({ workspace_id: c.workspace.id, thread_id: c.threadId, agent: c.agent, product, tool: t.name, input, title, why: PRODUCT_WHY[product] });
        await deps.activity({ workspace_id: c.workspace.id, agent: c.agent, thread_id: c.threadId, approval_id: ap.id, text: `prepared "${title}" for your approval` }).catch((e) => deps.log?.(`Activity wasn't saved: ${errText(e)}`));
        return { content: APPROVAL_MESSAGES.saved(ap.id), approval: { id: ap.id, title } };
      }
      try {
        const r = await deps.mcp.callTool(server, t.name, input);
        if (write) await deps.activity({ workspace_id: c.workspace.id, agent: c.agent, thread_id: c.threadId, approval_id: null, text: `ran "${title}" on autopilot` }).catch((e) => deps.log?.(`Activity wasn't saved: ${errText(e)}`));
        return { content: r.text || "(empty)", isError: r.isError };
      } catch (e) {
        return { content: `Tool failed: ${errText(e)}`, isError: true };
      }
    },
  };
}

/** The agent's tools in its products, for its workspace. Products that aren't ready are in `missing`. */
export function productToolSource(deps: ProductToolDeps): ToolSource {
  return async (ctx) => {
    const want = productsFor(ctx.agent);
    if (!want.length) return { tools: [], missing: [] };
    const readOnly = AGENTS[ctx.agent].readOnly === true;
    const rows = await deps.services(ctx.workspace.id);
    const parts = await Promise.all(want.map(async (product) => ({ product, c: await connect(product, ctx.workspace.id, rows, deps) })));
    const tools: ToolDef[] = [];
    const missing: string[] = [];
    for (const { product, c } of parts) {
      if (!c.ok) {
        missing.push(missingReason(product, c.status));
        continue;
      }
      for (const t of c.tools) {
        if (HIDDEN[product].has(t.name)) continue;
        const write = isWrite(t);
        if (write && readOnly) continue;
        tools.push(productTool(product, t, c.server, write, ctx, deps));
      }
    }
    return { tools, missing };
  };
}

/**
 * Runs an approved change with the workspace's brand key, after checking it is still allowed: the agent still works
 * through that product and may make changes, the service is ready, and the product still has the tool.
 */
export async function runApproval(ap: Pick<Approval, "workspace_id" | "agent" | "product" | "tool" | "input">, deps: ProductToolDeps): Promise<RunResult> {
  const product = PRODUCTS.find((p) => p === ap.product);
  if (!product) return { ok: false, text: "This kind of change isn't supported." };
  const a = AGENTS[ap.agent];
  if (!a || a.readOnly || !productsFor(ap.agent).includes(product)) return { ok: false, text: "This teammate can't make this change any more." };
  if (HIDDEN[product].has(ap.tool)) return { ok: false, text: "This change isn't allowed." };
  const c = await connect(product, ap.workspace_id, await deps.services(ap.workspace_id), deps);
  if (!c.ok) return { ok: false, text: blockedText(product, c.status) };
  if (!c.tools.some((t) => t.name === ap.tool)) return { ok: false, text: "This action isn't available any more." };
  try {
    const r = await deps.mcp.callTool(c.server, ap.tool, ap.input ?? {});
    return { ok: !r.isError, text: r.text };
  } catch (e) {
    deps.log?.(`Approved ${product} ${ap.tool} for workspace ${ap.workspace_id} failed: ${errText(e)}`);
    return { ok: false, text: "We couldn't reach this service right now. Try again in a few minutes." };
  }
}
