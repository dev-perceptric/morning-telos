// The card tools every teammate has (src/lib/cardTools.ts), and goal numbers from real data through the products'
// read tools (productRead in src/lib/productTools.ts, pickMetric in src/lib/goals.ts). Fake stores and fake MCP
// servers only: nothing reaches Supabase, Arrowsterr, Capybaroar or Anthropic.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import type { ChatEvent, TeamWorkspace, ToolContext } from "../src/lib/agentLoop.ts";
import { cardToolSource, cardTools, connectable, type ApprovalFace, type CardToolDeps, type GoalPatch } from "../src/lib/cardTools.ts";
import { INTERNAL_NAMES, type Card } from "../src/lib/cards.ts";
import { applyReading, METRIC_SOURCE, pickMetric, type GoalRow, type StepRow } from "../src/lib/goals.ts";
import { mcpClient, type McpTool } from "../src/lib/mcpClient.ts";
import type { Product } from "../src/lib/partner.ts";
import { productRead, type ProductToolDeps, type ServiceRow } from "../src/lib/productTools.ts";
import { openWith, sealWith, type Keyring } from "../src/lib/sealing.ts";
import type { AgentKey } from "../src/lib/team.ts";
import { ARROWSTERR_TOOLS, CAPYBAROAR_TOOLS, fakeMcp } from "./fakeMcp.ts";
import { withSoon } from "./soon.ts";

const NOW = Date.parse("2026-11-20T12:00:00Z");
const WS: TeamWorkspace = { id: "11111111-2222-4333-8444-555555555555", name: "Ana's Bakery", website: "anasbakery.com", plan: "trial", status: "trialing", trial_ends_at: new Date(NOW + 10 * 864e5).toISOString(), period_start: new Date(NOW).toISOString() };
const THREAD = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const goalRow = (over: Partial<GoalRow> = {}): GoalRow => ({
  id: "g-1",
  workspace_id: WS.id,
  thread_id: THREAD,
  card_id: "c_abcdefgh1234",
  agent: "social",
  metric: "followers",
  title: "Grow LinkedIn by",
  target: 150,
  unit: "followers",
  due_date: "2027-01-31",
  status: "active",
  current: 0,
  baseline: null,
  history: [],
  checked_at: null,
  created_at: "2026-11-18T12:00:00Z",
  ...over,
});

function fakes(o: { approvals?: ApprovalFace[]; goal?: GoalRow | null; steps?: StepRow[]; reading?: number | null } = {}) {
  const saved: { id: string; patch: GoalPatch }[] = [];
  const moved: { id: string; status: string }[] = [];
  const reads: string[] = [];
  let goal = o.goal ?? null;
  const deps: CardToolDeps = {
    approval: async (ws, id) => (ws === WS.id ? (o.approvals ?? []).find((a) => a.id === id) ?? null : null),
    activeGoal: async (ws, thread) => (ws === WS.id && goal?.thread_id === thread && goal.status === "active" ? goal : null),
    planSteps: async (ws, thread) => (ws === WS.id && thread === THREAD ? (o.steps ?? []) : []),
    setStep: async (_ws, id, status) => void moved.push({ id, status }),
    saveGoal: async (_ws, id, patch) => {
      saved.push({ id, patch });
      if (goal) goal = { ...goal, ...patch };
    },
    reading: async (_ws, metric) => (reads.push(metric), o.reading ?? null),
    pending: async () => 0,
    now: () => NOW,
  };
  return { deps, saved, moved, reads };
}

const ctx = (agent: AgentKey = "social", events: ChatEvent[] = []): ToolContext => ({ workspace: WS, agent, threadId: THREAD, trust: 0, emit: (e) => events.push(e) });
const tool = (deps: CardToolDeps, name: string, agent: AgentKey = "social", events: ChatEvent[] = []) => {
  const t = cardTools(ctx(agent, events), deps).find((x) => x.definition.name === name)!;
  return (input: Record<string, unknown>) => t.run(input, ctx(agent, events));
};

test("every working teammate gets the five card tools; they only shape the answer, so none waits for approval", async () => {
  const { deps } = fakes();
  for (const k of ["chief", "social", "seo", "web", "email", "sales", "support", "forms"] as AgentKey[]) {
    const set = await cardToolSource(deps)(ctx(k));
    assert.deepEqual(set.tools.map((t) => t.definition.name).sort(), ["log_progress", "set_goal", "set_plan", "show_card", "update_step"], k);
    assert.ok(set.tools.every((t) => !t.write && t.quiet), "no approvals, no progress line");
  }
  await withSoon("email", async () => assert.deepEqual((await cardToolSource(deps)(ctx("email"))).tools, []));
});

test("show_card: a good card is shown and saved with the reply; a bad one says why; text never names the services", async () => {
  const { deps } = fakes();
  const show = tool(deps, "show_card");
  const r = await show({ kind: "quick_replies", replies: ["Plan the week after", "Why these times?"] });
  assert.equal(r.isError, undefined);
  assert.equal(r.cards?.length, 1);
  assert.equal(r.cards![0].kind, "quick_replies");
  assert.match(r.content, /under your answer/);
  const ch = await show({ kind: "choices", questions: [{ label: "Where should we post?", options: ["LinkedIn", "Instagram"] }] });
  assert.match(ch.content, /Stop here and wait/);

  const bad = await show({ kind: "quick_replies", replies: ["one"] });
  assert.equal(bad.isError, true);
  assert.match(bad.content, /The card wasn't shown\. replies: needs at least 2/);
  assert.equal(bad.cards, undefined);
  const goal = await show({ kind: "goal", lead: "Grow by", target: 5, unit: "x", due: "2027-01-31" });
  assert.equal(goal.isError, true, "goals come from set_goal");

  const named = await show({ kind: "table", title: "From Arrowsterr", columns: ["Capybaroar channel"], rows: [["Composio app via MoltSets and DataForSEO"]] });
  const text = JSON.stringify(named.cards);
  for (const n of INTERNAL_NAMES) assert.ok(!text.toLowerCase().includes(n.toLowerCase()), n);
});

test("show_card: a connect card names an app the business can connect here", async () => {
  const { deps } = fakes();
  const show = tool(deps, "show_card");
  for (const app of ["gmail", "hubspot", "social", "wordpress"]) assert.equal((await show({ kind: "connect", app, text: "Connect it." })).isError, undefined, app);
  const r = await show({ kind: "connect", app: "myspace", text: "Connect it." });
  assert.equal(r.isError, true);
  assert.match(r.content, /isn't an app/);
  assert.equal(connectable("gmail"), true);
  assert.equal(connectable("capybaroar"), false);
});

test("show_card: a post preview must point at a social post saved in this chat, and shows that approval's own words", async () => {
  const post: ApprovalFace = { id: 12, thread_id: THREAD, product: "capybaroar", tool: "create_posts", status: "pending", input: { posts: [{ channel_ids: ["li-1"], text: "The words that will really go out" }] } };
  const other: ApprovalFace = { ...post, id: 13, thread_id: "another-thread" };
  const mail: ApprovalFace = { id: 14, thread_id: THREAD, product: "gmail", tool: "GMAIL_SEND_EMAIL", status: "pending", input: { recipient_email: "ana@example.com", subject: "Real subject", body: "Real body" } };
  const { deps } = fakes({ approvals: [post, other, mail] });
  const show = tool(deps, "show_card");
  const r = await show({ kind: "post_preview", posts: [{ approval_id: 12, network: "linkedin", text: "Something else the model wrote", when: "Tue 9:10 AM" }] });
  assert.equal(r.isError, undefined, r.content);
  const card = r.cards![0] as Extract<Card, { kind: "post_preview" }>;
  assert.equal(card.posts[0].text, "The words that will really go out", "Approve approves exactly what is shown");
  assert.equal(card.posts[0].approval_id, 12);

  assert.match((await show({ kind: "post_preview", posts: [{ approval_id: 13, network: "linkedin", text: "x" }] })).content, /isn't one saved in this chat/);
  assert.match((await show({ kind: "post_preview", posts: [{ approval_id: 99, network: "linkedin", text: "x" }] })).content, /isn't one saved in this chat/);
  assert.match((await show({ kind: "post_preview", posts: [{ approval_id: 14, network: "linkedin", text: "x" }] })).content, /isn't a social post/);
  assert.match((await show({ kind: "post_preview", posts: [{ approval_id: 12, index: 3, network: "linkedin", text: "x" }] })).content, /no post at that place/);
  // An X post's own words must still fit X.
  const long: ApprovalFace = { ...post, id: 15, input: { posts: [{ text: "x".repeat(300) }] } };
  assert.match((await tool(fakes({ approvals: [long] }).deps, "show_card")({ kind: "post_preview", posts: [{ approval_id: 15, network: "x", text: "short" }] })).content, /at most 280/);
  // A preview with no approval only shows (autopilot already posted it, say): the screen gives it no buttons.
  assert.equal((await show({ kind: "post_preview", posts: [{ network: "instagram", text: "Already out" }] })).isError, undefined);

  const em = await show({ kind: "email_preview", approval_id: 14, to: "someone@else.com", subject: "Model subject", body: "Model body" });
  assert.equal(em.isError, undefined, em.content);
  assert.deepEqual((({ to, subject, body }) => ({ to, subject, body }))(em.cards![0] as Extract<Card, { kind: "email_preview" }>), { to: "ana@example.com", subject: "Real subject", body: "Real body" });
  assert.match((await show({ kind: "email_preview", approval_id: 12, to: "a@b.co", subject: "S", body: "B" })).content, /isn't an email/);
});

test("set_goal: a goal card the person starts; a due date in the past, an unknown owner or a second goal in the chat is refused", async () => {
  const { deps } = fakes();
  const set = tool(deps, "set_goal");
  const r = await set({ metric: "followers", lead: "Grow LinkedIn by", target: 150, unit: "followers", due: "2027-01-31" });
  assert.equal(r.isError, undefined, r.content);
  const card = r.cards![0] as Extract<Card, { kind: "goal" }>;
  assert.deepEqual({ kind: card.kind, metric: card.metric, target: card.target, step: card.step, due: card.due, agent: card.agent, title: card.title }, { kind: "goal", metric: "followers", target: 150, step: 25, due: "2027-01-31", agent: "social", title: "Goal" });
  assert.match(r.content, /wait for Start/);
  assert.equal((await tool(deps, "set_goal", "chief")({ metric: "other", lead: "Get", target: 20, unit: "bookings", due: "2027-01-31", owner: "Hora" })).cards![0].agent, "forms");
  assert.match((await set({ metric: "other", lead: "Get", target: 20, unit: "bookings", due: "2026-11-01" })).content, /after today/);
  assert.match((await set({ metric: "other", lead: "Get", target: 20, unit: "bookings", due: "2030-01-01" })).content, /within two years/);
  assert.match((await set({ metric: "other", lead: "Get", target: 20, unit: "bookings", due: "2027-01-31", owner: "Zeus" })).content, /owner must be a teammate/);
  assert.match((await set({ metric: "sales", lead: "Get", target: 20, unit: "x", due: "2027-01-31" })).content, /metric: must be one of/);
  const busy = fakes({ goal: goalRow() }).deps;
  assert.match((await tool(busy, "set_goal")({ metric: "other", lead: "Get", target: 20, unit: "bookings", due: "2027-01-31" })).content, /already has a goal: Grow LinkedIn by 150 followers by Jan 31/);
});

test("set_plan: a plan card with who does each step; a teammate who can't take work is refused", async () => {
  const { deps } = fakes();
  const r = await tool(deps, "set_plan")({ steps: [{ title: "Learn your brand", owner: "Aphrodite" }, { title: "Find 4 topics", owner: "Artemis" }, { title: "Check in every Monday", owner: "Athena" }] });
  assert.equal(r.isError, undefined, r.content);
  const card = r.cards![0] as Extract<Card, { kind: "plan" }>;
  assert.deepEqual(card.steps.map((s) => s.agent), ["social", "seo", "chief"]);
  assert.equal(card.note, "3 steps");
  assert.match(r.content, /wait for Go/);
  await withSoon("seo", async () => {
    assert.match((await tool(deps, "set_plan")({ steps: [{ title: "Find topics", owner: "Artemis" }] })).content, /can't take work/);
  });
});

test("update_step: moves a step of the plan the person started, live on the card", async () => {
  const steps: StepRow[] = [
    { id: "s1", plan_id: "c_plan00000001", goal_id: "g-1", position: 1, title: "Learn your brand", agent: "social", status: "todo" },
    { id: "s2", plan_id: "c_plan00000001", goal_id: "g-1", position: 2, title: "Write 3 posts", agent: "social", status: "todo" },
  ];
  const { deps, moved } = fakes({ steps });
  const events: ChatEvent[] = [];
  const up = tool(deps, "update_step", "social", events);
  assert.equal((await up({ step: 2, status: "running" })).content, "Step 2 (Write 3 posts) is running.");
  assert.deepEqual(moved, [{ id: "s2", status: "running" }]);
  assert.deepEqual(events, [{ type: "step", plan: "c_plan00000001", position: 2, status: "running" }]);
  assert.match((await up({ step: 3, status: "done" })).content, /from 1 to 2/);
  assert.match((await up({ step: 1, status: "skipped" })).content, /running or done/);
  assert.match((await tool(fakes().deps, "update_step")({ step: 1, status: "done" })).content, /taps Go/);
});

test("log_progress: followers come from real data and count up from the start; a progress card shows where it stands", async () => {
  const { deps, saved, reads } = fakes({ goal: goalRow(), reading: 1200 });
  const events: ChatEvent[] = [];
  const log = tool(deps, "log_progress", "social", events);
  const first = await log({ value: 999 });
  assert.equal(first.isError, undefined, first.content);
  assert.deepEqual(reads, ["followers"]);
  assert.equal(saved[0].patch.baseline, 1200, "the first reading is the starting point");
  assert.equal(saved[0].patch.current, 0, "real data wins over the number the teammate gave");
  assert.deepEqual(events[0], { type: "goal", id: "g-1", current: 0, status: "active" });
  const card = first.cards![0] as Extract<Card, { kind: "progress" }>;
  assert.deepEqual({ kind: card.kind, current: card.current, target: card.target, status: card.status, start: card.start }, { kind: "progress", current: 0, target: 150, status: "on_track", start: "2026-11-18" });
  assert.match(first.content, /read from real data/);
});

test("log_progress: AI visibility is a level; other goals take the teammate's number; no number and no goal are refused", async () => {
  const vis = fakes({ goal: goalRow({ metric: "ai_visibility", title: "Get AI visibility to", target: 30, unit: "% of AI answers" }), reading: 23 });
  await tool(vis.deps, "log_progress")({});
  assert.equal(vis.saved[0].patch.current, 23);
  assert.equal(vis.saved[0].patch.baseline, null);

  const other = fakes({ goal: goalRow({ metric: "other", title: "Get", target: 20, unit: "bookings" }) });
  assert.match((await tool(other.deps, "log_progress")({})).content, /Give the current number in value/);
  assert.deepEqual(other.reads, [], "nothing to read for a goal no product measures");
  const r = await tool(other.deps, "log_progress")({ value: 20 });
  assert.equal(other.saved[0].patch.current, 20);
  assert.equal(other.saved[0].patch.status, "done");
  assert.match(r.content, /The goal is reached/);

  const down = fakes({ goal: goalRow(), reading: null });
  assert.match((await tool(down.deps, "log_progress")({})).content, /couldn't be read from real data/);
  assert.match((await tool(fakes().deps, "log_progress")({ value: 3 })).content, /no goal in this chat/);
});

test("a card tool made for one workspace or teammate never runs for another", async () => {
  const { deps } = fakes();
  const t = cardTools(ctx("social"), deps).find((x) => x.definition.name === "show_card")!;
  const r = await t.run({ kind: "quick_replies", replies: ["a", "b"] }, { ...ctx("social"), workspace: { ...WS, id: "other" } });
  assert.equal(r.isError, true);
  const r2 = await t.run({ kind: "quick_replies", replies: ["a", "b"] }, ctx("seo"));
  assert.equal(r2.isError, true);
});

// ─────────────── goal numbers from real data ───────────────

const AW_KEY = "aw_brand_ana_" + "s3cr3t";
const CB_KEY = "cbr_brand_ana_" + "s3cr3t";
const ring: Keyring = { current: "t1", keys: new Map([["t1", randomBytes(32)]]) };
const ANALYTICS: McpTool = { name: "get_analytics", title: "Analytics", description: "Reach and followers.", inputSchema: { type: "object", properties: { days: { type: "number" } } }, annotations: { readOnlyHint: true } };

function products(answers: Record<string, string>, o: { capybaroar?: Partial<ServiceRow> } = {}) {
  const srv = fakeMcp({
    tools: { [AW_KEY]: ARROWSTERR_TOOLS, [CB_KEY]: [...CAPYBAROAR_TOOLS, ANALYTICS] },
    hosts: ["aw.test", "cb.test"],
    call: (name) => ({ content: [{ type: "text", text: answers[name] ?? "{}" }] }),
  });
  const rows: ServiceRow[] = [
    { product: "arrowsterr", status: "ready", sealed_key: sealWith(ring, AW_KEY, `${WS.id}:arrowsterr`) },
    { product: "capybaroar", status: "ready", sealed_key: sealWith(ring, CB_KEY, `${WS.id}:capybaroar`), ...o.capybaroar },
  ];
  const deps: ProductToolDeps = {
    services: async (ws) => (ws === WS.id ? rows : []),
    openKey: (s, ws, p) => openWith(ring, s, `${ws}:${p}`),
    mcp: mcpClient({ fetch: srv.fetch }),
    urls: { arrowsterr: "https://aw.test/api/mcp", capybaroar: "https://cb.test/api/mcp" } as Record<Product, string>,
    saveApproval: async () => ({ id: 1 }),
    activity: async () => {},
  };
  return { srv, deps };
}

test("progress from real data: followers and reach from the social results, visibility from the SEO data, with the brand key", async () => {
  const { srv, deps } = products({ get_analytics: JSON.stringify({ period: { days: 30 }, totals: { reach: { current: 5400, previous: 4100 }, followers: 1234 } }), get_ai_visibility: JSON.stringify({ visibility: 23.5, sentiment: 71 }) });
  const read = async (metric: "followers" | "reach" | "ai_visibility") => {
    const src = METRIC_SOURCE[metric]!;
    const answer = await productRead(WS.id, src.product, src.tool, src.input, deps);
    return answer === null ? null : pickMetric(answer, src.keys);
  };
  assert.equal(await read("followers"), 1234);
  assert.equal(await read("reach"), 5400);
  assert.equal(await read("ai_visibility"), 23.5);
  const calls = srv.calls.filter((c) => c.method === "tools/call");
  assert.deepEqual(calls.map((c) => [new URL(c.url).hostname, c.params.name, c.key]), [
    ["cb.test", "get_analytics", CB_KEY],
    ["cb.test", "get_analytics", CB_KEY],
    ["aw.test", "get_ai_visibility", AW_KEY],
  ]);
  // A tool that changes something is never called this way, nor a hidden one, nor a product that isn't ready.
  assert.equal(await productRead(WS.id, "capybaroar", "create_posts", { posts: [] }, deps), null);
  assert.equal(await productRead(WS.id, "capybaroar", "get_credits", {}, deps), null);
  assert.equal(await productRead(WS.id, "capybaroar", "no_such_tool", {}, deps), null);
  assert.equal(await productRead(WS.id, "capybaroar", "get_analytics", {}, products({}, { capybaroar: { status: "pending" } }).deps), null);
  assert.equal(srv.calls.filter((c) => c.method === "tools/call" && c.params.name !== "get_analytics" && c.params.name !== "get_ai_visibility").length, 0);
});

test("pickMetric reads JSON (top level first, current over previous) and plain text; applyReading keeps the start and one point a day", () => {
  assert.equal(pickMetric('{"followers": {"current": 210, "previous": 180}}', ["followers"]), 210);
  assert.equal(pickMetric('{"channels": [{"followers": 50}], "followers": 75}', ["followers"]), 75);
  assert.equal(pickMetric('{"channels": [{"name": "LinkedIn", "followers": "1,050"}]}', ["followers"]), 1050);
  assert.equal(pickMetric("Visibility: 23%. Sentiment 70.", ["visibility"]), 23);
  assert.equal(pickMetric("No numbers here", ["followers"]), null);
  assert.equal(pickMetric('{"reach": "lots"}', ["reach"]), null);

  const g = goalRow();
  const a = applyReading(g, 1000, { now: NOW });
  assert.deepEqual(a, { current: 0, baseline: 1000, history: [{ at: "2026-11-20", value: 0 }], checked_at: new Date(NOW).toISOString(), status: "active" });
  const b = applyReading({ ...g, ...a }, 1012, { now: NOW + 3600_000 });
  assert.equal(b.current, 12);
  assert.deepEqual(b.history, [{ at: "2026-11-20", value: 12 }], "one point a day");
  const c = applyReading({ ...g, ...b }, 1150, { now: NOW + 7 * 864e5 });
  assert.equal(c.status, "done");
  assert.equal(c.history.length, 2);
  assert.equal(applyReading({ ...g, metric: "other" }, 7, { now: NOW, raw: false }).current, 7);
});
