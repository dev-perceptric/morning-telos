// A minimal MCP client over Streamable HTTP (JSON-RPC 2.0), for the AI team's tools in Arrowsterr and Capybaroar.
// Ported from the old app's app/lib/mcp.js: servers that answer with application/json or text/event-stream, the
// Mcp-Session-Id header, a new session when the server forgets ours (404), and tools/list kept for a few minutes.
//
// Each workspace reaches a product with its own brand key, so sessions and the tool list are kept per server and key.
// The key itself is only ever sent in the Authorization header. It is never put in an error, a log line or a cache
// key (those use a hash of it). Pure: fetch and the clock come in, so tests run it against fake servers.
import { createHash } from "node:crypto";

export const PROTOCOL = "2025-06-18";
/** How long a tools/list answer is kept for one server and key. */
export const TOOLS_TTL_MS = 5 * 60 * 1000;
/** How long one request may take: a list or a handshake, and a tool call (some write posts or make reports). */
export const LIST_TIMEOUT_MS = 20_000;
export const CALL_TIMEOUT_MS = 90_000;

export type McpServer = { url: string; key: string };
export type McpTool = {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean; title?: string };
};
export type McpCallResult = { text: string; isError: boolean };

/** A failed request. `status` is the HTTP status when the server answered, so callers can tell a refused key (401, 403). */
export class McpError extends Error {
  status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "McpError";
    this.status = status;
  }
}

export type McpClient = {
  listTools(server: McpServer, o?: { fresh?: boolean }): Promise<McpTool[]>;
  callTool(server: McpServer, name: string, args: Record<string, unknown>): Promise<McpCallResult>;
  /** Drops the session and tool list for a server and key (after a key changes). */
  forget(server: McpServer): void;
};

type Rpc = { jsonrpc: "2.0"; id?: number; result?: unknown; error?: { code?: number; message?: string } };

/** Where a server and key's session and tools are kept. A hash, so the key never sits in a map key or a log. */
export const serverId = (s: McpServer) => `${s.url}#${createHash("sha256").update(s.key).digest("hex").slice(0, 16)}`;

/** The JSON-RPC answer with this id, from a JSON body or an SSE stream. Null for an empty body. */
export function readRpc(contentType: string, body: string, id: number | undefined): Rpc | null {
  if (contentType.includes("text/event-stream")) {
    for (const chunk of body.split(/\r?\n\r?\n/)) {
      const data = chunk
        .split(/\r?\n/)
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).replace(/^ /, ""))
        .join("\n");
      if (!data.trim()) continue;
      try {
        const msg = JSON.parse(data) as Rpc;
        if (msg && msg.id === id) return msg;
      } catch {
        // Not JSON (a comment or a keep-alive). The answer may be in the next event.
      }
    }
    throw new McpError("The server sent no answer for this request.");
  }
  if (!body.trim()) return null;
  try {
    const msg = JSON.parse(body) as Rpc | Rpc[];
    if (Array.isArray(msg)) return msg.find((m) => m.id === id) ?? null;
    return msg;
  } catch {
    throw new McpError("The server's answer wasn't JSON.");
  }
}

/** A tool result as text: its text parts, other parts by type, structured content when there is no text. */
export function resultText(r: unknown): McpCallResult {
  const res = (r ?? {}) as { content?: { type?: string; text?: string }[]; structuredContent?: unknown; isError?: boolean };
  const parts = (Array.isArray(res.content) ? res.content : []).map((c) => (c?.type === "text" ? String(c.text ?? "") : `[${c?.type ?? "content"}]`));
  if (!parts.length && res.structuredContent !== undefined) parts.push(JSON.stringify(res.structuredContent));
  return { text: parts.join("\n"), isError: res.isError === true };
}

export function mcpClient(o: { fetch: typeof fetch; now?: () => number; listTimeoutMs?: number; callTimeoutMs?: number; ttlMs?: number; clientName?: string }): McpClient {
  const now = o.now ?? Date.now;
  const ttl = o.ttlMs ?? TOOLS_TTL_MS;
  const sessions = new Map<string, string | null>();
  const tools = new Map<string, { tools: McpTool[]; at: number }>();
  let nextId = 1;

  const headers = (s: McpServer, sid: string | null | undefined): Record<string, string> => ({
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    Authorization: `Bearer ${s.key}`,
    "MCP-Protocol-Version": PROTOCOL,
    ...(sid ? { "Mcp-Session-Id": sid } : {}),
  });

  async function post(s: McpServer, sid: string | null | undefined, body: unknown, timeoutMs: number): Promise<Response> {
    try {
      return await o.fetch(s.url, { method: "POST", headers: headers(s, sid), body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      const name = (e as Error)?.name;
      throw new McpError(name === "TimeoutError" || name === "AbortError" ? "The server took too long to answer." : "Couldn't reach the server.");
    }
  }

  /** Strips anything that looks like the key from what the server says, before it can reach a log or the model. */
  const scrub = (s: McpServer, text: string) => (s.key ? text.split(s.key).join("[key]") : text);

  async function answer(s: McpServer, res: Response, id: number | undefined): Promise<Rpc | null> {
    const text = await res.text().catch(() => "");
    if (!res.ok) throw new McpError(`The server answered ${res.status}: ${scrub(s, text).replace(/\s+/g, " ").slice(0, 200)}`, res.status);
    return readRpc(res.headers.get("content-type") ?? "", text, id);
  }

  async function initialize(s: McpServer): Promise<string | null> {
    const id = nextId++;
    const res = await post(s, null, { jsonrpc: "2.0", id, method: "initialize", params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: o.clientName ?? "morning-telos", version: "1.0.0" } } }, o.listTimeoutMs ?? LIST_TIMEOUT_MS);
    const msg = await answer(s, res, id);
    if (msg?.error) throw new McpError(scrub(s, msg.error.message || "The server refused to start a session."));
    const sid = res.headers.get("mcp-session-id");
    // The server is told we're ready. It answers 202 with no body; a failure here doesn't stop the call.
    await post(s, sid, { jsonrpc: "2.0", method: "notifications/initialized" }, o.listTimeoutMs ?? LIST_TIMEOUT_MS)
      .then((r) => r.text())
      .catch(() => {});
    sessions.set(serverId(s), sid);
    return sid;
  }

  async function rpc(s: McpServer, method: string, params: Record<string, unknown>, timeoutMs: number, again = true): Promise<unknown> {
    const key = serverId(s);
    const sid = sessions.has(key) ? sessions.get(key) : await initialize(s);
    const id = nextId++;
    const res = await post(s, sid, { jsonrpc: "2.0", id, method, params }, timeoutMs);
    // The server forgot our session (it restarted, or the session ran out): start a new one and try once more.
    if (res.status === 404 && sid && again) {
      await res.text().catch(() => "");
      sessions.delete(key);
      return rpc(s, method, params, timeoutMs, false);
    }
    const msg = await answer(s, res, id);
    if (msg?.error) throw new McpError(scrub(s, msg.error.message || "The server returned an error."));
    return msg?.result;
  }

  return {
    async listTools(s, opts = {}) {
      const key = serverId(s);
      const hit = tools.get(key);
      if (!opts.fresh && hit && now() - hit.at < ttl) return hit.tools;
      const out: McpTool[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 10; page++) {
        const r = (await rpc(s, "tools/list", cursor ? { cursor } : {}, o.listTimeoutMs ?? LIST_TIMEOUT_MS)) as { tools?: McpTool[]; nextCursor?: string } | undefined;
        for (const t of r?.tools ?? []) if (t && typeof t.name === "string") out.push(t);
        cursor = r?.nextCursor;
        if (!cursor) break;
      }
      tools.set(key, { tools: out, at: now() });
      return out;
    },
    async callTool(s, name, args) {
      const r = await rpc(s, "tools/call", { name, arguments: args ?? {} }, o.callTimeoutMs ?? CALL_TIMEOUT_MS);
      const out = resultText(r);
      return { ...out, text: scrub(s, out.text) };
    },
    forget(s) {
      sessions.delete(serverId(s));
      tools.delete(serverId(s));
    },
  };
}
