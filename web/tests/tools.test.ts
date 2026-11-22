// The AI team's tools: the registry (toolRegistry.ts), Arrowsterr and Capybaroar through brand keys (productTools.ts)
// and search_knowledge (knowledgeTools.ts). Fake MCP servers (tests/fakeMcp.ts) and a fake Claude: nothing reaches
// the real products or Anthropic.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import { runTurn, type ChatEvent, type LoopClient, type NewMessage, type TeamStore, type TeamWorkspace, type ToolContext, type ToolDef, type Trust } from "../src/lib/agentLoop.ts";
import type { NewApproval } from "../src/lib/approvals.ts";
import { knowledgeTool, knowledgeToolSource } from "../src/lib/knowledgeTools.ts";
import { mcpClient } from "../src/lib/mcpClient.ts";
import type { Product } from "../src/lib/partner.ts";
import { MCP_DEFAULTS, mcpUrls, missingReason, productsFor, productToolSource, productWrite, runApproval, toolName, type ActivityRow, type ProductToolDeps, type ServiceRow } from "../src/lib/productTools.ts";
import { openWith, sealWith, type Keyring } from "../src/lib/sealing.ts";
import { clipResult, composeTools, MAX_TOOL_RESULT, staticSource } from "../src/lib/toolRegistry.ts";
import { AGENTS, type AgentKey } from "../src/lib/team.ts";
import { withSoon } from "./soon.ts";
import { ARROWSTERR_TOOLS, CAPYBAROAR_TOOLS, fakeMcp } from "./fakeMcp.ts";

const NOW = Date.parse("2026-11-18T12:00:00Z");
const WS: TeamWorkspace = { id: "11111111-2222-4333-8444-555555555555", name: "Ana's Bakery", website: "anasbakery.com", plan: "trial", status: "trialing", trial_ends_at: new Date(NOW + 10 * 864e5).toISOString(), period_start: new Date(NOW).toISOString() };
const AW_KEY = "aw_brand_ana_" + "s3cr3t";
const CB_KEY = "cbr_brand_ana_" + "s3cr3t";
const ring: Keyring = { current: "t1", keys: new Map([["t1", randomBytes(32)]]) };
const URLS: Record<Product, string> = { arrowsterr: "https://aw.test/api/mcp", capybaroar: "https://cb.test/api/mcp" };

function setup(o: { services?: Partial<Record<Product, Partial<ServiceRow> | null>>; listFails?: boolean } = {}) {
  const srv = fakeMcp({ tools: { [AW_KEY]: ARROWSTERR_TOOLS, [CB_KEY]: CAPYBAROAR_TOOLS }, hosts: ["aw.test", "cb.test"] });
  const sealed: Record<Product, string> = { arrowsterr: sealWith(ring, AW_KEY, `${WS.id}:arrowsterr`), capybaroar: sealWith(ring, CB_KEY, `${WS.id}:capybaroar`) };
  const rows: ServiceRow[] = (["arrowsterr", "capybaroar"] as Product[]).flatMap((p) => {
    const over = o.services?.[p];
    if (over === null) return [];
    return [{ product: p, status: "ready", sealed_key: sealed[p], ...over }];
  });
  const approvals: (NewApproval & { id: number })[] = [];
  const activity: ActivityRow[] = [];
  const logs: string[] = [];
  const deps: ProductToolDeps = {
    services: async (ws) => (ws === WS.id ? rows : []),
    openKey: (s, ws, p) => openWith(ring, s, `${ws}:${p}`),
    mcp: mcpClient({ fetch: o.listFails ? ((async () => new Response("down", { status: 503 })) as typeof fetch) : srv.fetch }),
    urls: URLS,
    saveApproval: async (a) => {
      const id = approvals.length + 1;
      approvals.push({ ...a, id });
      return { id };
    },
    activity: async (r) => void activity.push(r),
    log: (m) => logs.push(m),
  };
  return { srv, sealed, rows, approvals, activity, logs, deps, source: productToolSource(deps) };
}

const ctx = (agent: AgentKey, trust: Trust = 0, events: ChatEvent[] = []): ToolContext => ({ workspace: WS, agent, threadId: "t-1", trust, emit: (e) => events.push(e) });
const names = (tools: ToolDef[]) => tools.map((t) => t.definition.name).sort();

// ─────────────── the registry ───────────────

test("composeTools: sources run together, a failing source is left out, the first tool of a name wins, results are cut", async () => {
  const mk = (name: string, content = name): ToolDef => ({ definition: { name, input_schema: { type: "object", properties: {} } }, label: name, run: async () => ({ content }) });
  const logs: string[] = [];
  const reg = composeTools(
    [
      staticSource([mk("a_tool", "first"), mk("big", "x".repeat(MAX_TOOL_RESULT + 50))]),
      async () => {
        throw new Error("source down");
      },
      staticSource((c) => (c.agent === "seo" ? [mk("a_tool", "second"), mk("seo_only")] : [])),
      staticSource([mk("handoff"), mk("bad name!")]),
      async () => ({ tools: [], missing: ["Social media (still being set up for this business)"] }),
      async () => ({ tools: [], missing: ["Social media (still being set up for this business)"] }),
    ],
    { log: (m) => logs.push(m) },
  );
  const set = await reg(ctx("seo"));
  assert.deepEqual(names(set.tools), ["a_tool", "big", "seo_only"]);
  assert.equal((await set.tools.find((t) => t.definition.name === "a_tool")!.run({}, ctx("seo"))).content, "first");
  const big = await set.tools.find((t) => t.definition.name === "big")!.run({}, ctx("seo"));
  assert.equal(big.content.length, MAX_TOOL_RESULT + "\n...(cut: 50 more characters)".length);
  assert.deepEqual(set.missing, ["Social media (still being set up for this business)"]);
  assert.match(logs.join("\n"), /Tool source 2 for seo .* failed: source down/);
  assert.match(logs.join("\n"), /"handoff" for seo was left out/);
  assert.match(logs.join("\n"), /"bad name!" for seo was left out/);
  assert.deepEqual(names((await reg(ctx("social"))).tools), ["a_tool", "big"]);
  assert.deepEqual(clipResult({ content: "abc", isError: true }, 10), { content: "abc", isError: true });
});

// ─────────────── which agent gets what ───────────────

test("productsFor: social on Capybaroar, seo and web on Arrowsterr, Alexander on both; Cyrus, Cleo, Midas and Irene work through the customer's own apps instead", async () => {
  assert.deepEqual(productsFor("social"), ["capybaroar"]);
  assert.deepEqual(productsFor("seo"), ["arrowsterr"]);
  assert.deepEqual(productsFor("web"), ["arrowsterr"]);
  assert.deepEqual(productsFor("chief"), ["arrowsterr", "capybaroar"]);
  for (const k of ["sales", "support", "forms", "email"] as AgentKey[]) assert.deepEqual(productsFor(k), [], k);
  await withSoon("social", () => assert.deepEqual(productsFor("social"), [], "coming soon teammates get none"));
});

test("each agent gets its own apps' tools, namespaced; Alexander gets reads only; hidden tools never show", async () => {
  const s = setup();
  assert.deepEqual(names((await s.source(ctx("social"))).tools), ["capybaroar__create_posts", "capybaroar__generate_media", "capybaroar__list_channels"]);
  assert.deepEqual(names((await s.source(ctx("seo"))).tools), ["arrowsterr__add_to_content_plan", "arrowsterr__get_ai_visibility", "arrowsterr__list_brands", "arrowsterr__remove_from_content_plan"]);
  const chief = await s.source(ctx("chief"));
  assert.deepEqual(names(chief.tools), ["arrowsterr__get_ai_visibility", "arrowsterr__list_brands", "capybaroar__list_channels"]);
  assert.ok(chief.tools.every((t) => !t.write));
  assert.deepEqual((await s.source(ctx("sales"))).tools, []);
  // Each product was reached with its own brand key only.
  assert.deepEqual([...new Set(s.srv.calls.filter((c) => c.url.startsWith(URLS.capybaroar)).map((c) => c.key))], [CB_KEY]);
  assert.deepEqual([...new Set(s.srv.calls.filter((c) => c.url.startsWith(URLS.arrowsterr)).map((c) => c.key))], [AW_KEY]);
});

test("a tool definition: label, description that says it changes something, the schema without $schema", async () => {
  const s = setup();
  const seo = (await s.source(ctx("seo"))).tools;
  const vis = seo.find((t) => t.definition.name === "arrowsterr__get_ai_visibility")!;
  assert.deepEqual(vis.definition, { name: "arrowsterr__get_ai_visibility", description: "[SEO and AI visibility] Share of AI answers that name the brand.", input_schema: { type: "object", properties: { days: { type: "integer" } } } });
  assert.equal(vis.label, "SEO and AI visibility: ai visibility");
  const add = seo.find((t) => t.definition.name === "arrowsterr__add_to_content_plan")!;
  assert.equal(add.write, true);
  assert.match(add.definition.description!, /^\[SEO and AI visibility, changes something\]/);
  assert.equal(toolName("capybaroar", "a.b c"), "capybaroar__a_b_c");
  assert.equal(toolName("arrowsterr", "x".repeat(80)).length, 64);
});

test("services that aren't ready are in missing, in plain English, and nothing is called for them", async () => {
  const s = setup({ services: { arrowsterr: { status: "waiting" }, capybaroar: null } });
  const set = await s.source(ctx("chief"));
  assert.deepEqual(set.tools, []);
  assert.deepEqual(set.missing, ["SEO and AI visibility (turns on once the business adds its website in Settings)", "Social media (still being set up for this business)"]);
  assert.equal(s.srv.calls.length, 0);
  assert.equal(missingReason("capybaroar", "failed"), "Social media (setup hit a problem, and Morning Telos is fixing it)");
  assert.equal(missingReason("capybaroar", "removed"), "Social media (turned off for this business)");
  assert.equal(missingReason("arrowsterr", "pending"), "SEO and AI visibility (still being set up for this business)");
  // Ready with no key yet counts as still being set up.
  assert.deepEqual((await setup({ services: { capybaroar: { sealed_key: null } } }).source(ctx("social"))).missing, ["Social media (still being set up for this business)"]);
});

test("a key that won't open or a server that won't list is 'temporarily unavailable', and staff get the details without the key", async () => {
  const s = setup({ services: { capybaroar: { sealed_key: "v2.t1.bad.bad.bad" } } });
  assert.deepEqual((await s.source(ctx("social"))).missing, ["Social media (temporarily unavailable)"]);
  assert.match(s.logs.join("\n"), /capybaroar brand key for workspace .* couldn't be opened/);
  // A key sealed for another workspace doesn't open here.
  const moved = setup();
  moved.rows[1].sealed_key = sealWith(ring, CB_KEY, `99999999-2222-4333-8444-555555555555:capybaroar`);
  assert.deepEqual((await moved.source(ctx("social"))).missing, ["Social media (temporarily unavailable)"]);
  const down = setup({ listFails: true });
  assert.deepEqual((await down.source(ctx("social"))).missing, ["Social media (temporarily unavailable)"]);
  assert.match(down.logs.join("\n"), /tools for workspace .* couldn't be listed: The server answered 503/);
  for (const l of [...s.logs, ...down.logs]) assert.ok(!l.includes(CB_KEY) && !l.includes(AW_KEY));
});

// ─────────────── reads, approvals and autopilot ───────────────

test("a read runs right away with the brand key", async () => {
  const s = setup();
  const t = (await s.source(ctx("seo"))).tools.find((x) => x.definition.name === "arrowsterr__get_ai_visibility")!;
  assert.deepEqual(await t.run({ days: 7 }, ctx("seo")), { content: 'get_ai_visibility ran with {"days":7}', isError: false });
  assert.deepEqual(s.approvals, []);
  assert.deepEqual(s.activity, []);
});

test("a change below autopilot is saved for approval, not run, and logged", async () => {
  for (const trust of [0, 1] as Trust[]) {
    const s = setup();
    const t = (await s.source(ctx("social", trust))).tools.find((x) => x.definition.name === "capybaroar__create_posts")!;
    const input = { posts: [{ text: "Fresh bread", channel_ids: ["c1"] }] };
    const r = await t.run(input, ctx("social", trust));
    assert.deepEqual(r, { content: "Saved for the owner's approval as #1. It has not run yet. Do not call it again.", approval: { id: 1, title: "Create posts (Social media)" } });
    assert.deepEqual(s.approvals, [{ id: 1, workspace_id: WS.id, thread_id: "t-1", agent: "social", product: "capybaroar", tool: "create_posts", input, title: "Create posts (Social media)", why: "This changes your social media, like posts, drafts or media." }]);
    assert.equal(s.srv.calls.filter((c) => c.method === "tools/call").length, 0, "nothing ran");
    assert.deepEqual(s.activity.map((a) => [a.agent, a.approval_id, a.text]), [["social", 1, 'prepared "Create posts (Social media)" for your approval']]);
  }
});

test("autopilot runs a change right away and logs it", async () => {
  const s = setup();
  const t = (await s.source(ctx("social", 2))).tools.find((x) => x.definition.name === "capybaroar__create_posts")!;
  const r = await t.run({ posts: [] }, ctx("social", 2));
  assert.deepEqual(r, { content: 'create_posts ran with {"posts":[]}', isError: false });
  assert.deepEqual(s.approvals, []);
  assert.deepEqual(s.activity.map((a) => [a.approval_id, a.text]), [[null, 'ran "Create posts (Social media)" on autopilot']]);
});

test("a tool made for one workspace or agent refuses to run for another", async () => {
  const s = setup();
  const t = (await s.source(ctx("social"))).tools[0];
  assert.deepEqual(await t.run({}, { ...ctx("social"), workspace: { ...WS, id: "other" } }), { content: "That tool isn't available.", isError: true });
  assert.deepEqual(await t.run({}, ctx("seo")), { content: "That tool isn't available.", isError: true });
});

test("a failed call comes back as a short error for the model", async () => {
  const s = setup();
  const mcp = { ...s.deps.mcp, callTool: async () => Promise.reject(new Error("The server took too long to answer.")) };
  const t = (await productToolSource({ ...s.deps, mcp })(ctx("social", 2))).tools.find((x) => x.definition.name === "capybaroar__list_channels")!;
  assert.deepEqual(await t.run({}, ctx("social", 2)), { content: "Tool failed: The server took too long to answer.", isError: true });
});

// ─────────────── the whole turn: the key never leaks ───────────────

function memoryStore(trust: Partial<Record<AgentKey, Trust>> = {}) {
  const messages: NewMessage[] = [];
  const store: TeamStore = {
    history: async () => messages.map((m) => ({ role: m.role, agent: m.agent, content: m.content, meta: m.meta })),
    addMessage: async (m) => void messages.push(m),
    prefs: async () => Object.fromEntries(Object.entries(trust).map(([k, t]) => [k, { trust: t }])),
    recordUsage: async () => {},
    spendSince: async () => 0,
    touchThread: async () => {},
  };
  return { store, messages };
}

test("a turn with product tools: namespaced tools reach Claude, a change becomes an approval, and the sealed key and brand key appear nowhere", async () => {
  const s = setup();
  const reg = composeTools([s.source, knowledgeToolSource(async () => [{ title: "Prices", snippet: "Sourdough $8" }])]);
  const requests: Anthropic.Beta.MessageCreateParamsNonStreaming[] = [];
  const replies: Anthropic.Beta.BetaContentBlock[][] = [
    [
      { type: "tool_use", id: "1", name: "capybaroar__list_channels", input: {} } as Anthropic.Beta.BetaContentBlock,
      { type: "tool_use", id: "2", name: "capybaroar__create_posts", input: { posts: [{ text: "Hi", channel_ids: ["c1"] }] } } as Anthropic.Beta.BetaContentBlock,
      { type: "tool_use", id: "3", name: "search_knowledge", input: { query: "prices" } } as Anthropic.Beta.BetaContentBlock,
    ],
    [{ type: "text", text: "I drafted a post for you to approve.", citations: null } as Anthropic.Beta.BetaContentBlock],
  ];
  const client: LoopClient = {
    beta: {
      messages: {
        create: async (p) => {
          requests.push(structuredClone(p));
          const content = replies.shift()!;
          return { id: "m", type: "message", role: "assistant", model: p.model, content, stop_reason: content[0].type === "tool_use" ? "tool_use" : "end_turn", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } as unknown as Anthropic.Beta.BetaMessage;
        },
      },
    },
  };
  const mem = memoryStore();
  await mem.store.addMessage({ thread_id: "t-1", workspace_id: WS.id, role: "user", agent: null, content: "@Leo post about bread", meta: {} });
  const events: ChatEvent[] = [];
  await runTurn({ workspace: WS, threadId: "t-1", text: "@Leo post about bread" }, { client, store: mem.store, emit: (e) => events.push(e), tools: reg, now: () => NOW });

  assert.deepEqual(
    (requests[0].tools as { name: string }[]).map((t) => t.name),
    ["capybaroar__create_posts", "capybaroar__generate_media", "capybaroar__list_channels", "search_knowledge", "handoff"],
  );
  assert.match((requests[0].system as { text: string }[])[0].text, /saved for the owner's approval instead of running/);
  const results = requests[1].messages.at(-1)!.content as Anthropic.Beta.BetaToolResultBlockParam[];
  assert.deepEqual(results.map((r) => r.content), ["list_channels ran with {}", "Saved for the owner's approval as #1. It has not run yet. Do not call it again.", "1. Prices\nSourdough $8"]);
  assert.deepEqual(events.filter((e) => e.type === "approval"), [{ type: "approval", agent: "social", id: 1, title: "Create posts (Social media)" }]);
  assert.deepEqual(mem.messages.at(-1)!.meta.approvals, [{ id: 1, title: "Create posts (Social media)" }]);
  assert.equal(s.srv.calls.filter((c) => c.method === "tools/call").map((c) => c.params.name).join(), "list_channels");

  const everything = JSON.stringify({ requests, events, messages: mem.messages, approvals: s.approvals, activity: s.activity, logs: s.logs });
  for (const secret of [CB_KEY, AW_KEY, s.sealed.capybaroar, s.sealed.arrowsterr]) assert.ok(!everything.includes(secret), "a key leaked");
});

// ─────────────── running an approved change ───────────────

const approved = (o: Partial<{ agent: AgentKey; product: string; tool: string; input: Record<string, unknown> }> = {}) => ({ workspace_id: WS.id, agent: "social" as AgentKey, product: "capybaroar", tool: "create_posts", input: { posts: [{ text: "Edited" }] }, ...o });

test("runApproval runs the (edited) details with the workspace's brand key", async () => {
  const s = setup();
  assert.deepEqual(await runApproval(approved(), s.deps), { ok: true, text: 'create_posts ran with {"posts":[{"text":"Edited"}]}' });
  const call = s.srv.calls.find((c) => c.method === "tools/call")!;
  assert.equal(call.key, CB_KEY);
  assert.deepEqual(call.params, { name: "create_posts", arguments: { posts: [{ text: "Edited" }] } });
});

test("runApproval checks again that it is still allowed", async () => {
  const s = setup();
  assert.deepEqual(await runApproval(approved({ agent: "chief" }), s.deps), { ok: false, text: "This teammate can't make this change any more." });
  assert.deepEqual(await runApproval(approved({ agent: "seo" }), s.deps), { ok: false, text: "This teammate can't make this change any more." });
  assert.deepEqual(await runApproval(approved({ agent: "sales" }), s.deps), { ok: false, text: "This teammate can't make this change any more." });
  assert.deepEqual(await runApproval(approved({ product: "zapier" }), s.deps), { ok: false, text: "This kind of change isn't supported." });
  assert.deepEqual(await runApproval(approved({ tool: "create_webhook" }), s.deps), { ok: false, text: "This change isn't allowed." });
  assert.deepEqual(await runApproval(approved({ tool: "delete_everything" }), s.deps), { ok: false, text: "This action isn't available any more." });
  const off = setup({ services: { capybaroar: { status: "removing" } } });
  assert.deepEqual(await runApproval(approved(), off.deps), { ok: false, text: "This is turned off for your business." });
  const none = setup({ services: { capybaroar: null } });
  assert.deepEqual(await runApproval(approved(), none.deps), { ok: false, text: "This service isn't set up for your business yet." });
  assert.equal(s.srv.calls.filter((c) => c.method === "tools/call").length, 0, "nothing ran");
});

test("runApproval: a product error is a failed result; a call that can't be made is a plain message", async () => {
  const s = setup();
  const errDeps = { ...s.deps, mcp: mcpClient({ fetch: fakeMcp({ tools: { [CB_KEY]: CAPYBAROAR_TOOLS }, call: () => ({ content: [{ type: "text", text: "Channel c9 isn't in this workspace." }], isError: true }) }).fetch }) };
  assert.deepEqual(await runApproval(approved(), errDeps), { ok: false, text: "Channel c9 isn't in this workspace." });
  const throwing = { ...s.deps, mcp: { ...s.deps.mcp, callTool: async () => Promise.reject(new Error("timeout")) } };
  assert.deepEqual(await runApproval(approved(), throwing), { ok: false, text: "We couldn't reach this service right now. Try again in a few minutes." });
});

// ─────────────── changes a person makes on a screen ───────────────

test("productWrite runs a person's calendar change with the brand key, and only the calendar's tools", async () => {
  const s = setup();
  assert.deepEqual(await productWrite(WS.id, "capybaroar", "create_posts", { posts: [{ text: "Hi" }] }, s.deps), { ok: true, text: 'create_posts ran with {"posts":[{"text":"Hi"}]}' });
  const call = s.srv.calls.find((c) => c.method === "tools/call")!;
  assert.equal(call.key, CB_KEY);
  // Not a calendar change, or a hidden tool: refused before anything is called.
  for (const tool of ["create_webhook", "generate_media", "get_credits"]) assert.deepEqual(await productWrite(WS.id, "capybaroar", tool, {}, s.deps), { ok: false, text: "This change isn't allowed." });
  assert.deepEqual(await productWrite(WS.id, "arrowsterr", "create_posts", {}, s.deps), { ok: false, text: "This change isn't allowed." });
  // Allowed, but this Capybaroar doesn't have it.
  assert.deepEqual(await productWrite(WS.id, "capybaroar", "delete_post", { id: "p1" }, s.deps), { ok: false, text: "This action isn't available any more." });
  const none = setup({ services: { capybaroar: null } });
  assert.deepEqual(await productWrite(WS.id, "capybaroar", "create_posts", {}, none.deps), { ok: false, text: "This service isn't set up for your business yet." });
  const throwing = { ...s.deps, mcp: { ...s.deps.mcp, callTool: async () => Promise.reject(new Error("timeout")) } };
  assert.deepEqual(await productWrite(WS.id, "capybaroar", "create_posts", {}, throwing), { ok: false, text: "We couldn't reach this service right now. Try again in a few minutes." });
  assert.equal(s.srv.calls.filter((c) => c.method === "tools/call").length, 1, "only the first one ran");
});

// ─────────────── search_knowledge and settings ───────────────

test("search_knowledge searches the agent's own workspace and says when nothing matches", async () => {
  const asked: [string, string, number][] = [];
  const t = knowledgeTool(async (ws, q, n) => (asked.push([ws, q, n]), q === "cake" ? [{ title: "Cakes", snippet: "Wedding cakes from $200" }] : []));
  assert.deepEqual(await t.run({ query: " cake ", limit: 50 }, ctx("seo")), { content: "1. Cakes\nWedding cakes from $200" });
  assert.deepEqual(await t.run({ query: "pies" }, ctx("seo")), { content: 'Nothing in Knowledge matches "pies".' });
  assert.deepEqual(await t.run({}, ctx("seo")), { content: "Give a few words to search for.", isError: true });
  assert.deepEqual(asked, [
    [WS.id, "cake", 20],
    [WS.id, "pies", 8],
  ]);
  assert.equal(t.write, undefined);
  const src = knowledgeToolSource(async () => []);
  assert.equal((await src(ctx("chief"))).tools.length, 1);
  for (const k of ["sales", "support", "forms", "email"] as AgentKey[]) assert.equal((await src(ctx(k))).tools.length, 1, `${AGENTS[k].god} searches Knowledge`);
  await withSoon("sales", async () => assert.equal((await src(ctx("sales"))).tools.length, 0, "coming soon teammates get none"));
});

test("mcpUrls: the live servers by default, the settings when given", () => {
  assert.deepEqual(mcpUrls({}), MCP_DEFAULTS);
  assert.deepEqual(MCP_DEFAULTS, { arrowsterr: "https://app.arrowsterr.com/api/mcp", capybaroar: "https://app.capybaroar.com/api/mcp" });
  assert.deepEqual(mcpUrls({ ARROWSTERR_MCP_URL: " https://aw.test/api/mcp/ ", CAPYBAROAR_MCP_URL: "not a url" }), { arrowsterr: "https://aw.test/api/mcp", capybaroar: MCP_DEFAULTS.capybaroar });
});
