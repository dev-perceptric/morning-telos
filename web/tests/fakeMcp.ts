// A fake MCP server (Streamable HTTP, JSON-RPC 2.0) behind a fetch function, standing in for Arrowsterr's and
// Capybaroar's /api/mcp. Each brand key sees only its own tools and answers. Nothing reaches the real products.
import type { McpTool } from "../src/lib/mcpClient.ts";

export type FakeCall = { url: string; key: string | null; session: string | null; method: string; params: Record<string, unknown> };
export type FakeMcpOptions = {
  /** Tools by brand key. A key that isn't here gets 401. */
  tools: Record<string, McpTool[]>;
  /** What tools/call answers, by tool name. Defaults to "<name> ran with <args>". */
  call?: (name: string, args: Record<string, unknown>, key: string) => { content: { type: string; text?: string }[]; isError?: boolean; structuredContent?: unknown };
  /** Answer as an SSE stream instead of JSON. */
  sse?: boolean;
  /** Only these hosts answer; anything else throws, so a test can't reach the internet. */
  hosts?: string[];
};

export function fakeMcp(o: FakeMcpOptions) {
  const calls: FakeCall[] = [];
  const sessions = new Set<string>();
  let n = 0;
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (o.hosts && !o.hosts.includes(url.hostname)) throw new Error(`test tried to reach ${url.hostname}`);
    const h = new Headers(init?.headers);
    const key = h.get("authorization")?.replace(/^Bearer /, "") ?? null;
    const session = h.get("mcp-session-id");
    const body = JSON.parse(String(init?.body ?? "{}")) as { id?: number; method: string; params?: Record<string, unknown> };
    calls.push({ url: url.toString(), key, session, method: body.method, params: body.params ?? {} });
    if (!key || !o.tools[key]) return new Response(JSON.stringify({ error: "invalid_token" }), { status: 401, headers: { "content-type": "application/json" } });
    const answer = (result: unknown, extra: Record<string, string> = {}) => {
      const msg = JSON.stringify({ jsonrpc: "2.0", id: body.id, result });
      return o.sse
        ? new Response(`: keep-alive\n\nevent: message\ndata: ${msg}\n\n`, { status: 200, headers: { "content-type": "text/event-stream", ...extra } })
        : new Response(msg, { status: 200, headers: { "content-type": "application/json", ...extra } });
    };
    if (body.method === "initialize") {
      const sid = `s${++n}`;
      sessions.add(sid);
      return answer({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake", version: "1" } }, { "mcp-session-id": sid });
    }
    if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (!session || !sessions.has(session)) return new Response("Session not found", { status: 404 });
    if (body.method === "tools/list") return answer({ tools: o.tools[key] });
    if (body.method === "tools/call") {
      const name = String(body.params?.name);
      const args = (body.params?.arguments ?? {}) as Record<string, unknown>;
      if (!o.tools[key].some((t) => t.name === name)) return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32602, message: `Unknown tool ${name}` } }), { status: 200, headers: { "content-type": "application/json" } });
      return answer(o.call ? o.call(name, args, key) : { content: [{ type: "text", text: `${name} ran with ${JSON.stringify(args)}` }] });
    }
    return answer({});
  }) as typeof globalThis.fetch;
  /** Forget every session, like a server restart. */
  const restart = () => sessions.clear();
  return { fetch, calls, restart };
}

const read = { readOnlyHint: true, openWorldHint: false };
const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: true };

/** Tools shaped like Arrowsterr's (src/lib/mcp/tools.ts there). */
export const ARROWSTERR_TOOLS: McpTool[] = [
  { name: "list_brands", title: "List brands", description: "Brands this key can see.", inputSchema: { type: "object", properties: {} }, annotations: read },
  { name: "get_ai_visibility", title: "AI visibility", description: "Share of AI answers that name the brand.", inputSchema: { $schema: "http://json-schema.org/draft-07/schema#", type: "object", properties: { days: { type: "integer" } } }, annotations: read },
  { name: "add_to_content_plan", title: "Add to content plan", description: "Adds topics to the content plan.", inputSchema: { type: "object", properties: { topics: { type: "array", items: { type: "string" } } }, required: ["topics"] }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true } },
  { name: "remove_from_content_plan", description: "Removes an item.", inputSchema: { type: "object", properties: { id: { type: "string" } } }, annotations: { readOnlyHint: false, destructiveHint: true } },
];

/** Tools shaped like Capybaroar's (src/lib/api/mcp.ts there). */
export const CAPYBAROAR_TOOLS: McpTool[] = [
  { name: "list_channels", title: "List channels", description: "Connected social channels.", inputSchema: { type: "object", properties: {} }, annotations: read },
  { name: "create_posts", title: "Create posts", description: "Drafts or schedules posts.", inputSchema: { type: "object", properties: { posts: { type: "array" } }, required: ["posts"] }, annotations: write },
  { name: "generate_media", title: "Make an AI image", description: "Uses credits.", inputSchema: { type: "object", properties: { prompt: { type: "string" } } }, annotations: write },
  { name: "get_credits", title: "Get AI credits", description: "The workspace's credits.", inputSchema: { type: "object", properties: {} }, annotations: read },
  { name: "create_webhook", title: "Create a webhook", description: "Sends events to a URL.", inputSchema: { type: "object", properties: { url: { type: "string" } } }, annotations: write },
];
