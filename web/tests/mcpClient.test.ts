// The MCP client (src/lib/mcpClient.ts) against a fake server (tests/fakeMcp.ts). Nothing reaches the real products.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CALL_TIMEOUT_MS, McpError, mcpClient, PROTOCOL, readRpc, resultText, serverId, TOOLS_TTL_MS } from "../src/lib/mcpClient.ts";
import { ARROWSTERR_TOOLS, fakeMcp } from "./fakeMcp.ts";

const URL_ = "https://aw.test/api/mcp";
const KEY = "aw_brand_secret_one";
const S = { url: URL_, key: KEY };

test("JSON answers: initialize, then tools/list with the session id, the key as a Bearer token and the protocol version", async () => {
  const srv = fakeMcp({ tools: { [KEY]: ARROWSTERR_TOOLS } });
  const seen: Headers[] = [];
  const mcp = mcpClient({ fetch: (i, init) => (seen.push(new Headers(init?.headers)), srv.fetch(i, init)) });
  const tools = await mcp.listTools(S);
  assert.deepEqual(tools.map((t) => t.name), ARROWSTERR_TOOLS.map((t) => t.name));
  assert.deepEqual(srv.calls.map((c) => [c.method, c.session]), [
    ["initialize", null],
    ["notifications/initialized", "s1"],
    ["tools/list", "s1"],
  ]);
  assert.equal(srv.calls[0].params.protocolVersion, PROTOCOL);
  for (const h of seen) {
    assert.equal(h.get("authorization"), `Bearer ${KEY}`);
    assert.equal(h.get("mcp-protocol-version"), PROTOCOL);
    assert.match(h.get("accept")!, /application\/json, text\/event-stream/);
  }
});

test("SSE answers: the JSON-RPC message with our id is picked from the stream", async () => {
  const srv = fakeMcp({ tools: { [KEY]: ARROWSTERR_TOOLS }, sse: true, call: () => ({ content: [{ type: "text", text: "visibility 42%" }] }) });
  const mcp = mcpClient({ fetch: srv.fetch });
  assert.equal((await mcp.listTools(S)).length, 4);
  assert.deepEqual(await mcp.callTool(S, "get_ai_visibility", { days: 7 }), { text: "visibility 42%", isError: false });
  assert.deepEqual(srv.calls.at(-1)!.params, { name: "get_ai_visibility", arguments: { days: 7 } });
});

test("readRpc: picks our id among other events, skips comments, and says when there is no answer", () => {
  const sse = 'event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\n\n: ping\n\ndata: {"jsonrpc":"2.0","id":3,\ndata: "result":{"ok":true}}\n\n';
  assert.deepEqual(readRpc("text/event-stream", sse, 3), { jsonrpc: "2.0", id: 3, result: { ok: true } });
  assert.throws(() => readRpc("text/event-stream", sse, 4), McpError);
  assert.equal(readRpc("application/json", "", 1), null);
  assert.deepEqual(readRpc("application/json", '[{"jsonrpc":"2.0","id":1,"result":1},{"jsonrpc":"2.0","id":2,"result":2}]', 2), { jsonrpc: "2.0", id: 2, result: 2 });
  assert.throws(() => readRpc("application/json", "<html>", 1), /wasn't JSON/);
});

test("tools/list is kept for 5 minutes per server and key, then asked again; fresh skips the cache", async () => {
  const OTHER = "aw_brand_secret_two";
  const srv = fakeMcp({ tools: { [KEY]: ARROWSTERR_TOOLS, [OTHER]: ARROWSTERR_TOOLS.slice(0, 1) } });
  let now = 1_000_000;
  const mcp = mcpClient({ fetch: srv.fetch, now: () => now });
  const lists = () => srv.calls.filter((c) => c.method === "tools/list").length;
  await mcp.listTools(S);
  await mcp.listTools(S);
  assert.equal(lists(), 1);
  // Another brand key on the same server is another customer: its own session and its own list.
  assert.equal((await mcp.listTools({ url: URL_, key: OTHER })).length, 1);
  assert.equal(lists(), 2);
  now += TOOLS_TTL_MS - 1;
  await mcp.listTools(S);
  assert.equal(lists(), 2);
  now += 2;
  await mcp.listTools(S);
  assert.equal(lists(), 3);
  await mcp.listTools(S, { fresh: true });
  assert.equal(lists(), 4);
  mcp.forget(S);
  await mcp.listTools(S);
  assert.equal(srv.calls.filter((c) => c.method === "initialize" && c.key === KEY).length, 2, "forget starts a new session");
});

test("tools/list follows nextCursor pages", async () => {
  let page = 0;
  const fetch = (async (_i: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    if (body.method === "initialize") return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }), { headers: { "content-type": "application/json", "mcp-session-id": "x" } });
    if (body.method !== "tools/list") return new Response(null, { status: 202 });
    page++;
    const result = page === 1 ? { tools: [{ name: "a" }], nextCursor: "p2" } : { tools: [{ name: "b" }] };
    assert.deepEqual(body.params, page === 1 ? {} : { cursor: "p2" });
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), { headers: { "content-type": "application/json" } });
  }) as typeof globalThis.fetch;
  assert.deepEqual((await mcpClient({ fetch }).listTools(S)).map((t) => t.name), ["a", "b"]);
});

test("a server that forgot the session (404) gets a new one, and the call is tried once more", async () => {
  const srv = fakeMcp({ tools: { [KEY]: ARROWSTERR_TOOLS } });
  const mcp = mcpClient({ fetch: srv.fetch });
  await mcp.listTools(S);
  srv.restart();
  const r = await mcp.callTool(S, "list_brands", {});
  assert.equal(r.text, "list_brands ran with {}");
  assert.deepEqual(srv.calls.slice(3).map((c) => [c.method, c.session]), [
    ["tools/call", "s1"],
    ["initialize", null],
    ["notifications/initialized", "s2"],
    ["tools/call", "s2"],
  ]);
});

test("errors: a refused key keeps its status, a JSON-RPC error is thrown, and the key never shows in a message", async () => {
  const srv = fakeMcp({ tools: { [KEY]: ARROWSTERR_TOOLS } });
  const mcp = mcpClient({ fetch: srv.fetch });
  const bad = { url: URL_, key: "aw_brand_wrong" };
  await assert.rejects(mcp.listTools(bad), (e: McpError) => e instanceof McpError && e.status === 401 && !e.message.includes(bad.key));
  await assert.rejects(mcp.callTool(S, "nope", {}), /Unknown tool nope/);
  // A server that repeats the key back gets it hidden.
  const echo = (async (_i: unknown, init?: RequestInit) => new Response(`bad key ${new Headers(init?.headers).get("authorization")}`, { status: 403 })) as typeof globalThis.fetch;
  await assert.rejects(mcpClient({ fetch: echo }).listTools(S), (e: McpError) => e.status === 403 && !e.message.includes(KEY) && e.message.includes("[key]"));
  const echoResult = fakeMcp({ tools: { [KEY]: ARROWSTERR_TOOLS }, call: () => ({ content: [{ type: "text", text: `your key is ${KEY}` }] }) });
  assert.equal((await mcpClient({ fetch: echoResult.fetch }).callTool(S, "list_brands", {})).text, "your key is [key]");
});

test("a network failure or a timeout is a short McpError, with no key in it", async () => {
  const down = (async () => {
    throw new TypeError(`fetch failed for ${KEY}`);
  }) as typeof globalThis.fetch;
  await assert.rejects(mcpClient({ fetch: down }).listTools(S), (e: McpError) => e.message === "Couldn't reach the server.");
  // AbortSignal.timeout doesn't keep the process alive, so the fake server holds a timer until it is aborted.
  const slow = ((_i: unknown, init?: RequestInit) =>
    new Promise((_, reject) => {
      const hold = setTimeout(() => {}, 5000);
      init?.signal?.addEventListener("abort", () => (clearTimeout(hold), reject(init.signal!.reason)));
    })) as typeof globalThis.fetch;
  await assert.rejects(mcpClient({ fetch: slow, listTimeoutMs: 20 }).listTools(S), (e: McpError) => e.message === "The server took too long to answer.");
  assert.ok(CALL_TIMEOUT_MS >= 60_000, "tool calls get a minute or more");
});

test("resultText: text parts joined, other parts by type, structured content when there is no text, isError kept", () => {
  assert.deepEqual(resultText({ content: [{ type: "text", text: "a" }, { type: "image" }, { type: "text", text: "b" }] }), { text: "a\n[image]\nb", isError: false });
  assert.deepEqual(resultText({ content: [], structuredContent: { n: 1 }, isError: true }), { text: '{"n":1}', isError: true });
  assert.deepEqual(resultText(undefined), { text: "", isError: false });
});

test("serverId hides the key", () => {
  assert.ok(!serverId(S).includes(KEY));
  assert.notEqual(serverId(S), serverId({ url: URL_, key: "other" }));
  assert.equal(serverId(S), serverId({ ...S }));
});
