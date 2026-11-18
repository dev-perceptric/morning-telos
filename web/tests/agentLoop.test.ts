// The AI team's turn (src/lib/agentLoop.ts) with a fake Claude and an in-memory store. Nothing reaches Anthropic.
import assert from "node:assert/strict";
import { test } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import {
  handoffTool,
  historyFor,
  MAX_RUNS,
  MAX_STEPS,
  runTurn,
  systemPrompt,
  TEAM_MESSAGES,
  whoAnswers,
  type AgentTool,
  type ChatEvent,
  type LoopClient,
  type NewMessage,
  type Pref,
  type StoredMessage,
  type TeamStore,
  type TeamWorkspace,
  type UsageRow,
} from "../src/lib/agentLoop.ts";
import { CAP_MESSAGES, costOf } from "../src/lib/meter.ts";
import { MODELS } from "../src/lib/models.ts";
import { AGENTS, type AgentKey } from "../src/lib/team.ts";

type Params = Anthropic.Beta.MessageCreateParamsNonStreaming;
type Block = Anthropic.Beta.BetaContentBlock;
type Reply = { content: Block[]; stop_reason: Anthropic.Beta.BetaStopReason; model?: string; usage?: Partial<Anthropic.Beta.BetaUsage> };

const NOW = Date.parse("2026-11-18T12:00:00Z");
const day = (n: number) => new Date(NOW + n * 864e5).toISOString();
const WS: TeamWorkspace = { id: "ws-1", name: "Ana's Bakery", website: "anasbakery.com", plan: "trial", status: "trialing", trial_ends_at: day(10), period_start: day(-4) };

const text = (t: string): Block => ({ type: "text", text: t, citations: null }) as Block;
const toolUse = (id: string, name: string, input: unknown): Block => ({ type: "tool_use", id, name, input }) as Block;
const say = (t: string): Reply => ({ content: [text(t)], stop_reason: "end_turn" });
const USAGE = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 3000, cache_creation_input_tokens: 500 };

/** Who a request is for, from its system prompt ("You are Athena, ..."). */
const agentOf = (p: Params): AgentKey => {
  const sys = Array.isArray(p.system) ? p.system[0].text : String(p.system);
  const god = sys.match(/^You are (\w+),/)![1];
  return (Object.keys(AGENTS) as AgentKey[]).find((k) => AGENTS[k].god === god)!;
};

/** A fake Claude. Each agent answers from its own script, in order. Every request is kept. */
function fakeClaude(scripts: Partial<Record<AgentKey, (Reply | Error)[]>>) {
  const calls: { agent: AgentKey; params: Params }[] = [];
  const client: LoopClient = {
    beta: {
      messages: {
        create: async (params) => {
          // A deep copy: the loop keeps adding to the same messages array.
          const agent = agentOf(params);
          calls.push({ agent, params: structuredClone(params) });
          const next = scripts[agent]?.shift();
          if (!next) throw new Error(`no scripted reply for ${agent}`);
          if (next instanceof Error) throw next;
          return { id: `msg_${calls.length}`, type: "message", role: "assistant", model: next.model ?? params.model, content: next.content, stop_reason: next.stop_reason, stop_sequence: null, usage: { ...USAGE, ...next.usage } } as unknown as Anthropic.Beta.BetaMessage;
        },
      },
    },
  };
  return { client, calls };
}

function memoryStore(o: { spent?: number; prefs?: Partial<Record<AgentKey, Partial<Pref>>>; history?: StoredMessage[] } = {}) {
  const messages: NewMessage[] = [];
  const usage: UsageRow[] = [];
  const spendAsked: string[] = [];
  let touched = 0;
  const store: TeamStore = {
    history: async () => [...(o.history ?? []), ...messages.map((m) => ({ role: m.role, agent: m.agent, content: m.content, meta: m.meta }))],
    addMessage: async (m) => void messages.push(m),
    prefs: async () => o.prefs ?? {},
    recordUsage: async (u) => void usage.push(u),
    spendSince: async (since) => (spendAsked.push(since), o.spent ?? 0),
    touchThread: async () => void touched++,
  };
  return { store, messages, usage, spendAsked, touched: () => touched };
}

/** Saves the person's message the way the route does, then runs the turn. */
async function turn(textIn: string, o: { client?: LoopClient | null; store?: ReturnType<typeof memoryStore>; ws?: TeamWorkspace; forced?: AgentKey; tools?: AgentTool[]; model?: "haiku" } = {}) {
  const mem = o.store ?? memoryStore();
  await mem.store.addMessage({ thread_id: "t-1", workspace_id: (o.ws ?? WS).id, role: "user", agent: null, content: textIn, meta: {} });
  const events: ChatEvent[] = [];
  const logs: string[] = [];
  await runTurn(
    { workspace: o.ws ?? WS, threadId: "t-1", text: textIn, forced: o.forced, model: o.model },
    { client: o.client === undefined ? fakeClaude({}).client : o.client, store: mem.store, emit: (e) => events.push(e), log: (m) => logs.push(m), now: () => NOW, tools: o.tools ? async () => ({ tools: o.tools!, missing: [] }) : undefined },
  );
  return { ...mem, events, logs, said: mem.messages.filter((m) => m.role !== "user") };
}

const lastUser = (p: Params) => p.messages[p.messages.length - 1];

// ─────────────── one agent ───────────────

test("no tag: Athena answers with a cached prompt, medium effort and the refusal fallback", async () => {
  const { client, calls } = fakeClaude({ chief: [say("Here is your week.")] });
  const r = await turn("Plan my week", { client });
  assert.equal(calls.length, 1);
  const p = calls[0].params;
  assert.equal(p.model, MODELS.auto);
  assert.equal(p.max_tokens, 16000);
  assert.deepEqual(p.output_config, { effort: "medium" });
  assert.deepEqual(p.cache_control, { type: "ephemeral" });
  assert.deepEqual((p as { fallbacks?: unknown }).fallbacks, "default");
  assert.deepEqual(p.betas, ["server-side-fallback-2026-07-01"]);
  assert.ok(Array.isArray(p.system));
  assert.deepEqual(p.system[0].cache_control, { type: "ephemeral" });
  assert.match(p.system[0].text, /^You are Athena, the Chief of Staff on the AI team of Ana's Bakery \(anasbakery\.com\)/);
  assert.equal(lastUser(p).role, "user");
  assert.equal(lastUser(p).content, "Plan my week");
  assert.deepEqual(r.said.map((m) => [m.role, m.agent, m.content]), [["agent", "chief", "Here is your week."]]);
  assert.deepEqual(
    r.events.map((e) => e.type),
    ["status", "message"],
  );
  assert.equal(r.touched(), 1);
});

test("the system prompt keeps the old app's rules: plain English, 9th grade, no em dashes, teammates listed", () => {
  const s = systemPrompt({ name: "Ana's Bakery", website: null }, "seo", { tools: false, missing: [], teammates: ["chief", "social", "web"] });
  assert.match(s, /^You are Artemis, the SEO Specialist on the AI team of Ana's Bakery\. Gets you found/);
  assert.match(s, /plain English at a 9th grade level\. Short sentences\. No em dashes\./);
  assert.match(s, /- Athena: Chief of Staff\. Runs the owner's day/);
  assert.match(s, /- Hermes: Sales Rep\. \(Coming soon, can't take work yet\.\)/);
  assert.match(s, /no tools connected yet/);
  assert.match(s, /call handoff/);
  assert.doesNotMatch(s, /[—–]/);
  // Nothing that changes from call to call, so it caches.
  assert.doesNotMatch(s, /\d{4}-\d{2}-\d{2}/);
  const withTools = systemPrompt({ name: "B", website: null }, "social", { tools: true, missing: ["Social media (temporarily unavailable)"], teammates: [] });
  assert.match(withTools, /saved for the owner's approval/);
  assert.match(withTools, /Not available right now: Social media \(temporarily unavailable\)/);
  assert.doesNotMatch(withTools, /call handoff/);
});

test("the handoff tool lists only the teammates given", () => {
  const t = handoffTool(["seo", "social"]);
  assert.equal(t.name, "handoff");
  assert.deepEqual((t.input_schema.properties as { teammate: { enum: string[] } }).teammate.enum, ["Artemis", "Aphrodite"]);
  assert.deepEqual(t.input_schema.required, ["teammate", "note"]);
});

test("Haiku runs without the server-side fallback, which it doesn't have", async () => {
  const { client, calls } = fakeClaude({ chief: [say("Hi.")] });
  await turn("Hello", { client, model: "haiku" });
  assert.equal(calls[0].params.model, MODELS.haiku);
  assert.equal((calls[0].params as { fallbacks?: unknown }).fallbacks, undefined);
  assert.equal(calls[0].params.betas, undefined);
});

test("an agent's model setting is used when the message doesn't pick one", async () => {
  const { client, calls } = fakeClaude({ chief: [say("Hi.")] });
  await turn("Hello", { client, store: memoryStore({ prefs: { chief: { model: "sonnet" } } }) });
  assert.equal(calls[0].params.model, MODELS.sonnet);
});

// ─────────────── handoffs and tags ───────────────

test("tool_use handoff: Athena hands to Artemis, who runs next and sees the note", async () => {
  const { client, calls } = fakeClaude({
    chief: [{ content: [text("Artemis can check that."), toolUse("tu_1", "handoff", { teammate: "Artemis", note: "Check our AI visibility this week." })], stop_reason: "tool_use" }, say("I asked Artemis to check.")],
    seo: [say("Your visibility is steady.")],
  });
  const r = await turn("How are we doing online?", { client });
  assert.deepEqual(
    calls.map((c) => c.agent),
    ["chief", "chief", "seo"],
  );
  // Athena's second call: her reply, then the tool result in one user message with the same id.
  const back = calls[1].params.messages;
  assert.equal(back[back.length - 2].role, "assistant");
  const results = back[back.length - 1].content as Anthropic.Beta.BetaToolResultBlockParam[];
  assert.equal(results.length, 1);
  assert.equal(results[0].tool_use_id, "tu_1");
  assert.match(String(results[0].content), /Artemis will take it from here/);
  assert.equal(results[0].is_error, undefined);
  // Artemis sees the person, Athena's reply and the handoff note as user text, and Athena isn't her own turn.
  const seen = calls[2].params.messages;
  assert.equal(seen.length, 1);
  assert.equal(seen[0].role, "user");
  assert.match(String(seen[0].content), /How are we doing online\?\n\nAthena: I asked Artemis to check\.\n\nAthena handed this to Artemis: Check our AI visibility this week\./);
  // Artemis can hand back to Athena but not to herself.
  const handoff = calls[2].params.tools!.find((t) => (t as { name: string }).name === "handoff") as Anthropic.Beta.BetaTool;
  assert.deepEqual((handoff.input_schema.properties as { teammate: { enum: string[] } }).teammate.enum, ["Athena", "Aphrodite", "Hephaestus"]);
  assert.deepEqual(
    r.said.map((m) => [m.role, m.agent]),
    [
      ["agent", "chief"],
      ["note", "chief"],
      ["agent", "seo"],
    ],
  );
  assert.deepEqual(r.said[1].meta, { to: "seo" });
  assert.deepEqual(
    r.events.filter((e) => e.type !== "status"),
    [
      { type: "message", agent: "chief", text: "I asked Artemis to check." },
      { type: "handoff", from: "chief", to: "seo", note: "Check our AI visibility this week." },
      { type: "message", agent: "seo", text: "Your visibility is steady." },
    ],
  );
});

test("a handoff to itself, a coming soon teammate or a paused one is refused, and nobody else runs", async () => {
  const { client, calls } = fakeClaude({
    chief: [
      {
        content: [toolUse("a", "handoff", { teammate: "Athena", note: "x" }), toolUse("b", "handoff", { teammate: "Hermes", note: "x" }), toolUse("c", "handoff", { teammate: "Aphrodite", note: "x" }), toolUse("d", "handoff", { teammate: "Artemis", note: " " })],
        stop_reason: "tool_use",
      },
      say("OK."),
    ],
  });
  const r = await turn("Do it all", { client, store: memoryStore({ prefs: { social: { enabled: false } } }) });
  assert.deepEqual(
    calls.map((c) => c.agent),
    ["chief", "chief"],
  );
  const results = calls[1].params.messages.at(-1)!.content as Anthropic.Beta.BetaToolResultBlockParam[];
  assert.deepEqual(
    results.map((x) => [x.tool_use_id, x.is_error]),
    [
      ["a", true],
      ["b", true],
      ["c", true],
      ["d", true],
    ],
  );
  assert.equal(r.events.filter((e) => e.type === "handoff").length, 0);
});

test("@mentions: tagged teammates answer in the order they were tagged, once each; unknown names are ignored", async () => {
  assert.deepEqual(whoAnswers("@Aphrodite and @artemis, then @Aphrodite again. cc @Zeus"), ["social", "seo"]);
  assert.deepEqual(whoAnswers("nobody tagged"), ["chief"]);
  assert.deepEqual(whoAnswers("ask @Artemis", "web"), ["web", "seo"]);
  assert.deepEqual(whoAnswers("ask @Hephaestus", "web"), ["web"]);
  assert.deepEqual(whoAnswers("email me at ana@artemis.com"), ["chief"]);

  const { client, calls } = fakeClaude({ social: [say("Posts planned.")], seo: [say("Keywords found.")] });
  const r = await turn("@Aphrodite plan posts and @Artemis find keywords", { client });
  assert.deepEqual(
    calls.map((c) => c.agent),
    ["social", "seo"],
  );
  // Artemis runs after Aphrodite: Aphrodite's reply comes to her as user text, so her request never ends on an assistant turn.
  assert.equal(lastUser(calls[1].params).role, "user");
  assert.match(String(lastUser(calls[1].params).content), /Aphrodite: Posts planned\./);
  assert.deepEqual(
    r.said.map((m) => m.agent),
    ["social", "seo"],
  );
});

test(`at most ${MAX_RUNS} replies a turn, then a note that the team stopped`, async () => {
  const { client, calls } = fakeClaude({});
  const r = await turn("@Hermes @Hestia @Hora @Iris @Athena hello", { client });
  assert.equal(calls.length, 0, "Athena is fifth, so she never runs");
  assert.deepEqual(
    r.said.map((m) => m.agent),
    ["sales", "support", "forms", "email", "chief"],
  );
  assert.equal(r.said[0].content, TEAM_MESSAGES.soon("sales"));
  assert.match(r.said[0].content, /Hermes is coming soon\. For now, ask Athena, Aphrodite, Artemis or Hephaestus\./);
  assert.equal(r.said[4].content, TEAM_MESSAGES.pausedTurn);
  assert.equal(r.said[4].role, "note");
});

test("a chain of handoffs stops at 4 replies", async () => {
  const hand = (to: string): Reply => ({ content: [toolUse(`h-${to}`, "handoff", { teammate: to, note: "your turn" })], stop_reason: "tool_use" });
  const { client, calls } = fakeClaude({
    chief: [hand("Artemis"), say("Passed on.")],
    seo: [hand("Aphrodite"), say("Passed on.")],
    social: [hand("Hephaestus"), say("Passed on.")],
    web: [hand("Athena"), say("Done here.")],
  });
  const r = await turn("Go", { client });
  assert.deepEqual([...new Set(calls.map((c) => c.agent))], ["chief", "seo", "social", "web"]);
  // Hephaestus handing back to Athena doesn't run her again: she already answered this turn.
  assert.equal(r.events.filter((e) => e.type === "handoff").length, 3);
  assert.equal(r.said.filter((m) => m.role === "agent").length, 4);
});

test("a paused teammate says so and doesn't call Claude", async () => {
  const { client, calls } = fakeClaude({});
  const r = await turn("@Artemis hi", { client, store: memoryStore({ prefs: { seo: { enabled: false } } }) });
  assert.equal(calls.length, 0);
  assert.equal(r.said[0].content, "Artemis is paused. An admin can turn them back on in Team.");
});

// ─────────────── how replies end ───────────────

test("refusal: a plain message, no tools run", async () => {
  let ran = 0;
  const tool: AgentTool = { definition: { name: "get_prompts", input_schema: { type: "object", properties: {} } }, label: "AI visibility: get prompts", run: async () => (ran++, { content: "x" }) };
  const { client, calls } = fakeClaude({ chief: [{ content: [toolUse("t", "get_prompts", {})], stop_reason: "refusal" }] });
  const r = await turn("Something odd", { client, tools: [tool] });
  assert.equal(calls.length, 1);
  assert.equal(ran, 0);
  assert.equal(r.said[0].content, TEAM_MESSAGES.refused);
});

test("max_tokens: a cut-off tool call is never run, and the reply says it got too long", async () => {
  let ran = 0;
  const tool: AgentTool = { definition: { name: "get_prompts", input_schema: { type: "object", properties: {} } }, label: "x", run: async () => (ran++, { content: "x" }) };
  const { client, calls } = fakeClaude({ chief: [{ content: [text("Here is a long plan"), toolUse("t", "get_prompts", { half: "writ" })], stop_reason: "max_tokens" }] });
  const r = await turn("Write everything", { client, tools: [tool] });
  assert.equal(calls.length, 1);
  assert.equal(ran, 0);
  assert.equal(r.said[0].content, `Here is a long plan\n\n${TEAM_MESSAGES.tooLong}`);
});

test("pause_turn: the reply goes back and the agent keeps going", async () => {
  const { client, calls } = fakeClaude({ chief: [{ content: [text("Working on it")], stop_reason: "pause_turn" }, say("All done.")] });
  const r = await turn("Go", { client });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].params.messages.at(-1)!.role, "assistant");
  assert.equal(r.said[0].content, "All done.");
});

test(`an agent stops after ${MAX_STEPS} steps`, async () => {
  const loop: Reply = { content: [toolUse("x", "get_prompts", {})], stop_reason: "tool_use" };
  const tool: AgentTool = { definition: { name: "get_prompts", input_schema: { type: "object", properties: {} } }, label: "x", run: async () => ({ content: "more" }) };
  const { client, calls } = fakeClaude({ chief: Array.from({ length: 20 }, () => structuredClone(loop)) });
  const r = await turn("Loop", { client, tools: [tool] });
  assert.equal(calls.length, MAX_STEPS);
  assert.equal(r.said[0].content, TEAM_MESSAGES.tooManySteps);
  assert.equal(r.usage.length, MAX_STEPS);
});

// ─────────────── the tool registry hook ───────────────

test("tools from the registry: run in parallel, labels shown, all results in one message, errors kept", async () => {
  const order: string[] = [];
  const mk = (name: string, run: AgentTool["run"]): AgentTool => ({ definition: { name, input_schema: { type: "object", properties: {} } }, label: `Label ${name}`, run });
  const tools = [
    mk("zeta_read", async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push("zeta");
      return { content: "zeta data" };
    }),
    mk("alpha_read", async (input, ctx) => {
      order.push("alpha");
      assert.equal(ctx.workspace.id, "ws-1");
      assert.equal(ctx.agent, "chief");
      assert.equal(ctx.trust, 2);
      return { content: `alpha ${JSON.stringify(input)}` };
    }),
    mk("broken", async () => {
      throw new Error("down");
    }),
  ];
  const { client, calls } = fakeClaude({
    chief: [{ content: [toolUse("1", "zeta_read", {}), toolUse("2", "alpha_read", { q: 1 }), toolUse("3", "broken", {}), toolUse("4", "nope", {})], stop_reason: "tool_use" }, say("Here's what I found.")],
  });
  const r = await turn("Look it up", { client, tools, store: memoryStore({ prefs: { chief: { trust: 2 } } }) });
  // Sorted by name, handoff last, so the cached prefix is the same every time.
  assert.deepEqual(
    calls[0].params.tools!.map((t) => (t as { name: string }).name),
    ["alpha_read", "broken", "zeta_read", "handoff"],
  );
  assert.deepEqual(order, ["alpha", "zeta"], "alpha didn't wait for zeta");
  const results = calls[1].params.messages.at(-1)!.content as Anthropic.Beta.BetaToolResultBlockParam[];
  assert.deepEqual(
    results.map((x) => [x.tool_use_id, x.content, x.is_error ?? false]),
    [
      ["1", "zeta data", false],
      ["2", 'alpha {"q":1}', false],
      ["3", "Tool failed: down", true],
      ["4", "That tool isn't available.", true],
    ],
  );
  assert.deepEqual(
    r.events.filter((e) => e.type === "tool").map((e) => (e as { text: string }).text),
    ["Label zeta_read", "Label alpha_read", "Label broken"],
  );
  assert.match(calls[0].params.system![0].text as string, /saved for the owner's approval/);
});

test("prompt context (knowledge, skills, memory) goes in a second cached system block", async () => {
  const { client, calls } = fakeClaude({ chief: [say("Hi.")] });
  const mem = memoryStore();
  await mem.store.addMessage({ thread_id: "t-1", workspace_id: "ws-1", role: "user", agent: null, content: "Hi", meta: {} });
  await runTurn({ workspace: WS, threadId: "t-1", text: "Hi" }, { client, store: mem.store, emit: () => {}, now: () => NOW, context: async (agent) => [`<knowledge for="${agent}">We bake bread.</knowledge>`] });
  const sys = calls[0].params.system as Anthropic.Beta.BetaTextBlockParam[];
  assert.equal(sys.length, 2);
  assert.equal(sys[1].text, '<knowledge for="chief">We bake bread.</knowledge>');
  assert.deepEqual(sys[1].cache_control, { type: "ephemeral" });
});

// ─────────────── the meter ───────────────

test("every call writes a usage row with its cost, priced by the model that served it", async () => {
  const { client } = fakeClaude({
    chief: [
      { content: [toolUse("1", "handoff", { teammate: "Artemis", note: "check" })], stop_reason: "tool_use", usage: { input_tokens: 2000, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 4000 } },
      // A declined request that the server ran again on a fallback model.
      { content: [text("Done.")], stop_reason: "end_turn", model: "claude-opus-4-8", usage: { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 6000, cache_creation_input_tokens: 0 } },
    ],
    seo: [say("Checked.")],
  });
  const r = await turn("Check", { client });
  assert.equal(r.usage.length, 3);
  assert.deepEqual(r.usage[0], {
    workspace_id: "ws-1",
    thread_id: "t-1",
    agent: "chief",
    model: "claude-opus-5-5",
    input_tokens: 2000,
    output_tokens: 100,
    cache_read_tokens: 0,
    cache_write_tokens: 4000,
    // 2000 x $4 + 100 x $20 + 4000 x $5 per million
    cost_usd: 0.03,
  });
  assert.equal(r.usage[1].model, "claude-opus-4-8");
  assert.equal(r.usage[1].cost_usd, costOf("claude-opus-4-8", { input: 10, output: 10, cacheRead: 6000, cacheWrite: 0 }));
  assert.equal(r.usage[2].agent, "seo");
});

test("allowance: a trial that spent its $5 is stopped before Claude is called; under it runs", async () => {
  const blocked = fakeClaude({});
  const r = await turn("Hi", { client: blocked.client, store: memoryStore({ spent: 5 }) });
  assert.equal(blocked.calls.length, 0);
  assert.deepEqual(r.said.map((m) => [m.agent, m.content, m.meta]), [["chief", CAP_MESSAGES.trialAllowance, { blocked: "allowance" }]]);
  assert.deepEqual(r.events, [{ type: "message", agent: "chief", text: CAP_MESSAGES.trialAllowance, blocked: "allowance" }]);
  // The trial's spend counts from the start of the trial.
  assert.equal(r.spendAsked[0], day(-4));

  const pro: TeamWorkspace = { ...WS, plan: "pro", status: "active" };
  const ok = fakeClaude({ chief: [say("Sure.")] });
  await turn("Hi", { client: ok.client, ws: pro, store: memoryStore({ spent: 49.99 }) });
  assert.equal(ok.calls.length, 1);
  const over = fakeClaude({});
  const r2 = await turn("Hi", { client: over.client, ws: pro, store: memoryStore({ spent: 50 }) });
  assert.equal(over.calls.length, 0);
  assert.equal(r2.said[0].content, CAP_MESSAGES.allowance);
});

test("allowance: a handoff doesn't run once the turn has used up what was left", async () => {
  const { client, calls } = fakeClaude({
    chief: [{ content: [toolUse("1", "handoff", { teammate: "Artemis", note: "go" })], stop_reason: "tool_use", usage: { input_tokens: 1_000_000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }, say("Passed on.")],
  });
  const r = await turn("Go", { client, store: memoryStore({ spent: 1 }) });
  assert.deepEqual(
    calls.map((c) => c.agent),
    ["chief", "chief"],
  );
  assert.equal(r.said.at(-1)!.content, CAP_MESSAGES.trialAllowance);
});

test("expired plan: a trial that ended or a canceled plan is stopped before anything else", async () => {
  const { client, calls } = fakeClaude({});
  const ended = await turn("Hi", { client, ws: { ...WS, trial_ends_at: day(-1) } });
  assert.equal(ended.said[0].content, CAP_MESSAGES.trialOver);
  assert.deepEqual(ended.said[0].meta, { blocked: "expired" });
  assert.equal(ended.spendAsked.length, 0);
  const canceled = await turn("Hi", { client, ws: { ...WS, plan: "pro", status: "canceled", trial_ends_at: day(-30) } });
  assert.equal(canceled.said[0].content, CAP_MESSAGES.stopped);
  assert.equal(calls.length, 0);
});

test("missing ANTHROPIC_API_KEY: the team is starting up, and nothing crashes", async () => {
  const r = await turn("Hi", { client: null });
  assert.equal(r.said[0].content, "Your AI team is starting up. Please try again in a few minutes.");
  assert.deepEqual(r.events, [{ type: "message", agent: "chief", text: CAP_MESSAGES.startingUp, blocked: "starting" }]);
});

test("API errors become one short line: a bad key reads as starting up, busy as busy, others as broken", async () => {
  const err = (status: number) => Anthropic.APIError.generate(status, { error: { type: "x", message: "nope" } }, "nope", new Headers());
  assert.ok(err(429) instanceof Anthropic.RateLimitError);

  const bad = await turn("Hi", { client: fakeClaude({ chief: [err(401)] }).client });
  assert.deepEqual(bad.said[0].meta, { error: true });
  assert.equal(bad.said[0].content, CAP_MESSAGES.startingUp);
  assert.equal(bad.logs.length, 1);

  const busy = await turn("@Athena @Artemis hi", { client: fakeClaude({ chief: [err(429)], seo: [say("Here.")] }).client });
  assert.equal(busy.said[0].content, TEAM_MESSAGES.busy);
  assert.equal(busy.said[1].content, "Here.", "the next teammate still runs");
  assert.ok(busy.events.some((e) => e.type === "message" && e.error));

  const broken = await turn("Hi", { client: fakeClaude({ chief: [new Error("socket hang up")] }).client });
  assert.equal(broken.said[0].content, TEAM_MESSAGES.broken);
});

// ─────────────── history ───────────────

test("history: own replies are the assistant, teammates and notes are user text, team notices are left out", () => {
  const rows: StoredMessage[] = [
    { role: "agent", agent: "chief", content: "Orphan reply" },
    { role: "user", agent: null, content: "Hi team" },
    { role: "agent", agent: "chief", content: "Hello!" },
    { role: "agent", agent: "chief", content: "Your trial ended.", meta: { blocked: "expired" } },
    { role: "agent", agent: "seo", content: "Something went wrong.", meta: { error: true } },
    { role: "note", agent: "chief", content: "Athena handed this to Artemis: check" },
    { role: "user", agent: null, content: "  " },
  ];
  assert.deepEqual(historyFor(rows, "chief"), [
    { role: "user", content: "Hi team" },
    { role: "assistant", content: "Hello!" },
    { role: "user", content: "Athena handed this to Artemis: check" },
  ]);
  assert.deepEqual(historyFor(rows, "seo"), [{ role: "user", content: "Athena: Orphan reply\n\nHi team\n\nAthena: Hello!\n\nAthena handed this to Artemis: check" }]);
  // Never ends on the agent's own turn (no prefill on current models).
  const own = historyFor([{ role: "user", agent: null, content: "Hi" }, { role: "agent", agent: "web", content: "Hey" }], "web");
  assert.equal(own.at(-1)!.role, "user");
  assert.deepEqual(historyFor([], "web"), [{ role: "user", content: "Hephaestus, it's your turn. Answer the last message." }]);
});
