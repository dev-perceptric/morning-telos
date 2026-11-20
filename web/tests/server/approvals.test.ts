// POST /api/approvals/:id, and POST /api/chat with product tools, with a fake database, a fake Claude and fake
// Arrowsterr and Capybaroar MCP servers behind globalThis.fetch (any other address fails the test).
// Run with: node --conditions=react-server --test tests/server/*.test.ts (part of npm test).

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { register } from "node:module";
import { beforeEach, test } from "node:test";
import { ARROWSTERR_TOOLS, CAPYBAROAR_TOOLS, fakeMcp } from "../fakeMcp.ts";
import { fakeDb } from "./fakeDb.ts";
import { claude } from "./stubs/claude.ts";
import { auth } from "./stubs/serverAuth.ts";

register("./tsResolve.mjs", import.meta.url);

// Fake settings, only for this test process.
process.env.SEALING_KEYS = `t1:${randomBytes(32).toString("base64")}`;
process.env.ARROWSTERR_MCP_URL = "https://aw.test/api/mcp";
process.env.CAPYBAROAR_MCP_URL = "https://cb.test/api/mcp";

const AW_KEY = "aw_brand_ana_test_key";
const CB_KEY = "cbr_brand_ana_test_key";
const srv = fakeMcp({ tools: { [AW_KEY]: ARROWSTERR_TOOLS, [CB_KEY]: CAPYBAROAR_TOOLS }, hosts: ["aw.test", "cb.test"] });
globalThis.fetch = srv.fetch;

const route = await import("../../src/app/api/approvals/[id]/route.ts");
const chat = await import("../../src/app/api/chat/route.ts");
const { seal } = await import("../../src/lib/sealing.ts");

const WS = "11111111-2222-4333-8444-555555555555";
const OTHER = "11111111-2222-4333-8444-666666666666";
const THREAD = "22222222-2222-4333-8444-555555555555";
const soon = new Date(Date.now() + 5 * 864e5).toISOString();

let db: ReturnType<typeof fakeDb>;

const pending = (id: number, o: Record<string, unknown> = {}) => ({
  id,
  workspace_id: WS,
  thread_id: THREAD,
  agent: "social",
  product: "capybaroar",
  tool: "create_posts",
  input: { posts: [{ text: "Fresh bread today", channel_ids: ["c1"] }] },
  title: "Create posts (Social media)",
  why: "This changes your social media, like posts, drafts or media.",
  status: "pending",
  result: null,
  decided_by: null,
  created_at: new Date().toISOString(),
  decided_at: null,
  finished_at: null,
  ...o,
});

beforeEach(() => {
  db = fakeDb({}, { autoId: ["messages", "ai_usage", "approvals", "activity"] });
  db.tables.workspaces = [
    { id: WS, name: "Ana's Bakery", website: "anasbakery.com", plan: "trial", status: "trialing", trial_ends_at: soon, period_start: new Date().toISOString() },
    { id: OTHER, name: "Other Co", website: null, plan: "trial", status: "trialing", trial_ends_at: soon, period_start: new Date().toISOString() },
  ];
  db.tables.workspace_members = [
    { workspace_id: WS, user_id: "editor1", role: "editor" },
    { workspace_id: WS, user_id: "viewer1", role: "viewer" },
    { workspace_id: OTHER, user_id: "owner2", role: "owner" },
  ];
  db.tables.services = [
    { workspace_id: WS, product: "arrowsterr", status: "ready", sealed_key: seal(AW_KEY, `${WS}:arrowsterr`) },
    { workspace_id: WS, product: "capybaroar", status: "ready", sealed_key: seal(CB_KEY, `${WS}:capybaroar`) },
  ];
  db.tables.threads = [{ id: THREAD, workspace_id: WS, title: "Posts" }];
  db.tables.messages = [];
  db.tables.agent_prefs = [];
  db.tables.ai_usage = [];
  db.tables.activity = [];
  db.tables.approvals = [pending(1), pending(2, { workspace_id: OTHER, thread_id: null })];
  db.rpcs.ai_spend = () => 0;
  db.rpcs.search_knowledge = () => [];
  // The same rules as supabase/013_approvals.sql: an editor or up of the workspace, and only a pending approval, once.
  db.rpcs.decide_approval = (a) => {
    const RANK: Record<string, number> = { owner: 4, admin: 3, editor: 2, viewer: 1 };
    const m = db.tables.workspace_members.find((x) => x.workspace_id === a.p_ws && x.user_id === a.p_by);
    if (!m || RANK[m.role as string] < 2) return [];
    const row = db.tables.approvals.find((x) => x.id === a.p_id && x.workspace_id === a.p_ws && x.status === "pending");
    if (!row) return [];
    Object.assign(row, { status: a.p_action === "approve" ? "running" : "denied", decided_by: a.p_by, decided_at: new Date().toISOString(), ...(a.p_action === "approve" && a.p_input ? { input: a.p_input } : {}) });
    return [{ ...row }];
  };
  db.rpcs.finish_approval = (a) => {
    const row = db.tables.approvals.find((x) => x.id === a.p_id && x.workspace_id === a.p_ws && (x.status === "running" || x.status === "approved"));
    if (!row) return false;
    Object.assign(row, { status: a.p_status, result: a.p_result, finished_at: new Date().toISOString() });
    return true;
  };
  auth.db = db;
  auth.roles = new Map([
    [`editor1:${WS}`, "editor"],
    [`viewer1:${WS}`, "viewer"],
    [`owner2:${OTHER}`, "owner"],
  ]);
  srv.calls.length = 0;
  claude.client = null;
});

const decide = (user: string | null, id: string | number, body: Record<string, unknown>) =>
  route.POST(new Request(`https://app.test/api/approvals/${id}`, { method: "POST", headers: user ? { Authorization: `Bearer ${user}` } : {}, body: JSON.stringify({ workspaceId: WS, ...body }) }), { params: Promise.resolve({ id: String(id) }) });

const productCalls = () => srv.calls.filter((c) => c.method === "tools/call");

test("viewers, strangers and signed-out people can't decide, and nothing runs or changes", async () => {
  const v = await decide("viewer1", 1, { action: "approve" });
  assert.equal(v.status, 403);
  assert.match((await v.json()).error, /editor access/);
  assert.equal((await decide("owner2", 1, { action: "approve" })).status, 403, "the owner of another workspace");
  assert.equal((await decide(null, 1, { action: "approve" })).status, 401);
  assert.equal(db.writes.length, 0);
  assert.equal(db.tables.approvals[0].status, "pending");
  assert.equal(productCalls().length, 0);
});

test("an editor approves: it runs with the workspace's brand key, the result is saved, and the chat gets a note", async () => {
  const res = await decide("editor1", 1, { action: "approve" });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.deepEqual(await res.json(), { status: "done", result: 'create_posts ran with {"posts":[{"text":"Fresh bread today","channel_ids":["c1"]}]}' });
  const [call] = productCalls();
  assert.equal(call.url, "https://cb.test/api/mcp");
  assert.equal(call.key, CB_KEY);
  assert.deepEqual(call.params, { name: "create_posts", arguments: { posts: [{ text: "Fresh bread today", channel_ids: ["c1"] }] } });
  const ap = db.tables.approvals[0];
  assert.deepEqual([ap.status, ap.decided_by, typeof ap.finished_at], ["done", "editor1", "string"]);
  assert.deepEqual(
    db.tables.messages.map((m) => [m.thread_id, m.workspace_id, m.role, m.agent, m.content, m.meta]),
    [[THREAD, WS, "note", "social", "Approved and done: Create posts (Social media)", { approval: 1, status: "done" }]],
  );
  assert.deepEqual(db.tables.activity.map((a) => [a.workspace_id, a.agent, a.approval_id, a.text]), [[WS, "social", 1, "finished: Create posts (Social media)"]]);
});

test("approve with edited details runs the edited details and keeps them", async () => {
  const input = { posts: [{ text: "Fresh sourdough today", channel_ids: ["c1"] }] };
  const res = await decide("editor1", 1, { action: "approve", input });
  assert.equal((await res.json()).status, "done");
  assert.deepEqual(productCalls()[0].params.arguments, input);
  assert.deepEqual(db.tables.approvals[0].input, input);
});

test("deny: nothing runs, and the chat hears it wasn't approved", async () => {
  const res = await decide("editor1", 1, { action: "deny" });
  assert.deepEqual(await res.json(), { status: "denied" });
  assert.equal(productCalls().length, 0);
  assert.equal(db.tables.approvals[0].status, "denied");
  assert.equal(db.tables.messages[0].content, "Not approved: Create posts (Social media)");
});

test("a second approve is refused and runs nothing", async () => {
  assert.equal((await decide("editor1", 1, { action: "approve" })).status, 200);
  const again = await decide("editor1", 1, { action: "approve" });
  assert.equal(again.status, 409);
  assert.equal((await again.json()).error, "This one was already handled.");
  assert.equal((await decide("editor1", 1, { action: "deny" })).status, 409);
  assert.equal(productCalls().length, 1);
});

test("another workspace's approval is not found; a bad id or action is refused", async () => {
  const res = await decide("editor1", 2, { action: "approve" });
  assert.equal(res.status, 404);
  assert.equal(db.tables.approvals[1].status, "pending");
  assert.equal((await decide("editor1", "abc", { action: "approve" })).status, 404);
  const bad = await decide("editor1", 1, { action: "run" });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error, "Pick approve or deny.");
  assert.equal((await decide("editor1", 1, { action: "approve", input: [1, 2] })).status, 400);
  assert.equal(productCalls().length, 0);
});

test("a service that was turned off since: the approval fails with a plain reason and nothing runs", async () => {
  db.tables.services[1].status = "removing";
  const res = await decide("editor1", 1, { action: "approve" });
  assert.deepEqual(await res.json(), { status: "failed", result: "This is turned off for your business." });
  assert.equal(db.tables.approvals[0].status, "failed");
  assert.equal(db.tables.messages[0].content, "Approved, but it didn't work: Create posts (Social media)");
  assert.equal(productCalls().length, 0);
});

test("the database's own check: someone the server thinks is an editor but who isn't one there gets nothing", async () => {
  auth.roles.set(`viewer1:${WS}`, "editor");
  const res = await decide("viewer1", 1, { action: "approve" });
  assert.equal(res.status, 409);
  assert.equal(db.tables.approvals[0].status, "pending");
  assert.equal(productCalls().length, 0);
});

// ─────────────── the chat route with product tools ───────────────

test("chat: Aphrodite gets Capybaroar's tools through the brand key, and a change is saved for approval, not run", async () => {
  const requests: { tools?: { name: string }[]; system: { text: string }[] }[] = [];
  let step = 0;
  claude.client = {
    beta: {
      messages: {
        create: async (p: { model: string; tools?: { name: string }[]; system: { text: string }[] }) => {
          requests.push(structuredClone(p));
          step++;
          const content =
            step === 1
              ? [
                  { type: "tool_use", id: "1", name: "capybaroar__list_channels", input: {} },
                  { type: "tool_use", id: "2", name: "capybaroar__create_posts", input: { posts: [{ text: "Hi", channel_ids: ["c1"] }] } },
                ]
              : [{ type: "text", text: "I drafted one post for you to approve." }];
          return { id: "m", type: "message", role: "assistant", model: p.model, content, stop_reason: step === 1 ? "tool_use" : "end_turn", usage: { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } };
        },
      },
    },
  };
  const res = await chat.POST(new Request("https://app.test/api/chat", { method: "POST", headers: { Authorization: "Bearer editor1" }, body: JSON.stringify({ workspaceId: WS, threadId: THREAD, text: "@Aphrodite post about bread" }) }));
  const events = (await res.text())
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  assert.deepEqual(
    requests[0].tools!.map((t) => t.name),
    ["capybaroar__create_posts", "capybaroar__generate_media", "capybaroar__list_channels", "log_progress", "remember", "search_knowledge", "set_goal", "set_plan", "show_card", "update_step", "use_skill", "handoff"],
  );
  const saved = db.tables.approvals.find((a) => a.id !== 1 && a.id !== 2)!;
  assert.deepEqual([saved.workspace_id, saved.thread_id, saved.agent, saved.product, saved.tool, saved.title], [WS, THREAD, "social", "capybaroar", "create_posts", "Create posts (Social media)"]);
  assert.deepEqual(saved.input, { posts: [{ text: "Hi", channel_ids: ["c1"] }] });
  assert.ok(events.some((e) => e.type === "approval" && e.id === saved.id && e.agent === "social"));
  assert.deepEqual(productCalls().map((c) => c.params.name), ["list_channels"], "the change didn't run");
  const reply = db.tables.messages.at(-1)!;
  assert.deepEqual((reply.meta as { approvals: unknown }).approvals, [{ id: saved.id, title: "Create posts (Social media)" }]);
  assert.deepEqual(db.tables.activity.map((a) => a.text), ['prepared "Create posts (Social media)" for your approval']);
  const all = JSON.stringify({ requests, events, messages: db.tables.messages, approvals: db.tables.approvals });
  assert.ok(!all.includes(CB_KEY) && !all.includes(AW_KEY), "a brand key leaked");
  assert.ok(!all.includes(String(db.tables.services[1].sealed_key)), "a sealed key leaked");
});

test("chat: on autopilot the change runs right away and is logged", async () => {
  db.tables.agent_prefs = [{ workspace_id: WS, agent: "social", enabled: true, trust: 2, model: "auto" }];
  let step = 0;
  claude.client = {
    beta: {
      messages: {
        create: async (p: { model: string }) => {
          step++;
          const content = step === 1 ? [{ type: "tool_use", id: "1", name: "capybaroar__create_posts", input: { posts: [] } }] : [{ type: "text", text: "Posted." }];
          return { id: "m", type: "message", role: "assistant", model: p.model, content, stop_reason: step === 1 ? "tool_use" : "end_turn", usage: { input_tokens: 1, output_tokens: 1 } };
        },
      },
    },
  };
  const res = await chat.POST(new Request("https://app.test/api/chat", { method: "POST", headers: { Authorization: "Bearer editor1" }, body: JSON.stringify({ workspaceId: WS, threadId: THREAD, text: "@Aphrodite post it" }) }));
  await res.text();
  assert.deepEqual(productCalls().map((c) => c.params.name), ["create_posts"]);
  assert.equal(db.tables.approvals.length, 2, "no approval saved");
  assert.deepEqual(db.tables.activity.map((a) => a.text), ['ran "Create posts (Social media)" on autopilot']);
});
