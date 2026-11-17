// Minimal MCP client over Streamable HTTP (JSON-RPC 2.0).
// Supports servers that answer with application/json or text/event-stream.
const PROTOCOL = "2025-06-18";
const sessions = new Map(); // url -> { sid, at }
const toolCache = new Map(); // url -> { tools, at }

function headers(key, sid) {
  const h = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
  if (key) h.Authorization = `Bearer ${key}`;
  if (sid) h["Mcp-Session-Id"] = sid;
  h["MCP-Protocol-Version"] = PROTOCOL;
  return h;
}

async function readRpc(res, id) {
  const type = res.headers.get("content-type") || "";
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`MCP server answered ${res.status}: ${text.slice(0, 300)}`);
  }
  if (type.includes("text/event-stream")) {
    // Pick the JSON-RPC message with our id from the SSE stream.
    for (const chunk of text.split(/\n\n/)) {
      const data = chunk.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
      if (!data) continue;
      try {
        const msg = JSON.parse(data);
        if (msg.id === id) return msg;
      } catch {}
    }
    throw new Error("MCP server sent no answer for this request");
  }
  if (!text) return null;
  return JSON.parse(text);
}

let nextId = 1;
async function rpc(url, key, method, params, { notify = false, retry = true } = {}) {
  let s = sessions.get(url);
  if (!s && method !== "initialize") {
    await initialize(url, key);
    s = sessions.get(url);
  }
  const id = notify ? undefined : nextId++;
  const body = notify ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id, method, params };
  const res = await fetch(url, { method: "POST", headers: headers(key, s?.sid), body: JSON.stringify(body), signal: AbortSignal.timeout(120000) });
  if (res.status === 404 && s && retry) {
    // Session expired on the server: start a new one and retry once.
    sessions.delete(url);
    return rpc(url, key, method, params, { notify, retry: false });
  }
  if (notify) return null;
  const msg = await readRpc(res, id);
  if (method === "initialize") {
    sessions.set(url, { sid: res.headers.get("mcp-session-id") || null, at: Date.now() });
  }
  if (msg?.error) throw new Error(msg.error.message || "MCP error");
  return msg?.result;
}

export async function initialize(url, key) {
  sessions.delete(url);
  const r = await rpc(url, key, "initialize", {
    protocolVersion: PROTOCOL,
    capabilities: {},
    clientInfo: { name: "morning-telos", version: "0.1.0" },
  });
  await rpc(url, key, "notifications/initialized", {}, { notify: true });
  return r;
}

export async function listTools(url, key, { fresh = false } = {}) {
  const c = toolCache.get(url);
  if (!fresh && c && Date.now() - c.at < 10 * 60 * 1000) return c.tools;
  const tools = [];
  let cursor;
  for (let page = 0; page < 10; page++) {
    const r = await rpc(url, key, "tools/list", cursor ? { cursor } : {});
    tools.push(...(r?.tools || []));
    cursor = r?.nextCursor;
    if (!cursor) break;
  }
  toolCache.set(url, { tools, at: Date.now() });
  return tools;
}

export async function callTool(url, key, name, args) {
  const r = await rpc(url, key, "tools/call", { name, arguments: args || {} });
  const parts = (r?.content || []).map((c) => (c.type === "text" ? c.text : `[${c.type}]`));
  if (r?.structuredContent && !parts.length) parts.push(JSON.stringify(r.structuredContent));
  return { text: parts.join("\n"), isError: !!r?.isError };
}

export function forget(url) {
  sessions.delete(url);
  toolCache.delete(url);
}
