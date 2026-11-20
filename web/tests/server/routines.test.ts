// Routines, skills and memory on the server: the worker's run_routine job, Run now through POST /api/chat, a skill
// picked with /, and the use_skill and remember tools. A fake database and a fake Claude (stubs/claude.ts): nothing
// reaches Supabase or Anthropic.
// Run with: node --conditions=react-server --test tests/server/*.test.ts (part of npm test).

import assert from "node:assert/strict";
import { register } from "node:module";
import { beforeEach, test } from "node:test";
import { fakeDb } from "./fakeDb.ts";
import { claude, isRouter, routerReply } from "./stubs/claude.ts";
import { auth } from "./stubs/serverAuth.ts";

register("./tsResolve.mjs", import.meta.url);

const SECRET = "test-cron-secret-routines";
process.env.CRON_SECRET = SECRET;

const worker = await import("../../src/app/api/worker/route.ts");
const chat = await import("../../src/app/api/chat/route.ts");
const { CAP_MESSAGES } = await import("../../src/lib/meter.ts");
const { CHAT_MESSAGES } = await import("../../src/lib/chat.ts");
const { SKIP_NOTES } = await import("../../src/lib/routines.ts");
const { MEMORY_MESSAGES } = await import("../../src/lib/memory.ts");

const WS = "11111111-2222-4333-8444-555555555555";
const OTHER = "11111111-2222-4333-8444-666666666666";
const R1 = "22222222-2222-4333-8444-555555555555";
const R_OTHER = "22222222-2222-4333-8444-666666666666";
const soon = new Date(Date.now() + 5 * 864e5).toISOString();

type Req = { model: string; system: { text: string }[]; tools?: { name: string }[]; messages: { role: string; content: unknown }[] };
type Reply = { content: Record<string, unknown>[]; stop_reason: string };

let db: ReturnType<typeof fakeDb>;
let spent: number;
let requests: Req[];
let replies: Reply[];
let queued: number;

const text = (t: string): Reply => ({ content: [{ type: "text", text: t }], stop_reason: "end_turn" });
const call = (name: string, input: Record<string, unknown>, id = `tu_${name}`): Reply => ({ content: [{ type: "tool_use", id, name, input }], stop_reason: "tool_use" });

beforeEach(() => {
  db = fakeDb({}, { autoId: ["messages", "ai_usage", "memories"] });
  db.tables.workspaces = [
    { id: WS, name: "Ana's Bakery", website: "anasbakery.com", plan: "trial", status: "trialing", trial_ends_at: soon, period_start: new Date().toISOString(), timezone: "America/Chicago" },
    { id: OTHER, name: "Other Co", website: null, plan: "trial", status: "trialing", trial_ends_at: soon, period_start: new Date().toISOString(), timezone: "UTC" },
  ];
  db.tables.routines = [
    { id: R1, workspace_id: WS, agent: "social", title: "Plan posts", instruction: "Plan next week's posts with /plan-weekly-posts", days: [1], at_time: "08:00", enabled: true, last_run_at: null, last_note: "Skipped earlier", last_thread_id: null, created_by: "owner1" },
    { id: R_OTHER, workspace_id: OTHER, agent: "seo", title: "Theirs", instruction: "Check theirs", days: [1], at_time: "08:00", enabled: true, last_run_at: null, last_note: null, last_thread_id: null, created_by: "owner2" },
  ];
  db.tables.threads = [];
  db.tables.messages = [];
  db.tables.agent_prefs = [];
  db.tables.ai_usage = [];
  db.tables.knowledge_docs = [{ workspace_id: WS, title: "Hours", body: "Open 7 to 3.", agent: null, source: "manual", updated_at: "2026-11-01T00:00:00Z" }];
  db.tables.memories = [{ id: "m1", workspace_id: WS, agent: null, fact: "Closed on Mondays.", thread_id: null, created_at: "2026-11-02T00:00:00Z" }];
  db.tables.skills = [];
  db.tables.jobs = [];
  spent = 0;
  queued = 0;
  db.rpcs.ai_spend = (a) => (a.p_ws === WS ? spent : 0);
  db.rpcs.queue_daily_jobs = () => 0;
  db.rpcs.queue_routine_runs = () => {
    queued++;
    return 0;
  };
  db.rpcs.claim_jobs = () => db.tables.jobs.map((j) => ({ ...j }));
  auth.db = db;
  auth.roles = new Map([
    [`editor1:${WS}`, "editor"],
    [`viewer1:${WS}`, "viewer"],
    [`owner2:${OTHER}`, "owner"],
  ]);
  requests = [];
  replies = [];
  claude.client = {
    beta: {
      messages: {
        create: async (p: Req) => {
          // An untagged message is routed first. Athena takes it, as before routing.
          if (isRouter(p)) return routerReply("Athena");
          requests.push(structuredClone(p));
          const r = replies.shift() ?? text("Here is the plan.");
          return { id: "m", type: "message", role: "assistant", model: p.model, ...r, usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } };
        },
      },
    },
  };
});

const tick = () => worker.POST(new Request("https://app.test/api/worker", { method: "POST", headers: { authorization: `Bearer ${SECRET}` } }));
const routineJob = (routine = R1, ws = WS) => ({ id: 7, kind: "run_routine", workspace_id: ws, payload: { routine, slot: "2026-11-16T14:00:00Z" }, attempts: 1, max_attempts: 1, locked_until: null });
const routine = () => db.tables.routines.find((r) => r.id === R1)!;

test("each worker tick queues due routines first, and a failure there doesn't stop the jobs", async () => {
  db.tables.jobs = [routineJob()];
  const res = await tick();
  assert.deepEqual(await res.json(), { claimed: 1, done: 1, retry: 0, failed: 0 });
  assert.equal(queued, 1);
  // Before 014 runs: the function isn't there.
  delete db.rpcs.queue_routine_runs;
  const again = await tick();
  assert.equal(again.status, 200);
});

test("run_routine: a new chat called Routine: <title>, the instruction as the message, and the routine's teammate answers", async () => {
  db.tables.jobs = [routineJob()];
  await tick();
  assert.equal(db.tables.threads.length, 1);
  const t = db.tables.threads[0];
  assert.deepEqual([t.workspace_id, t.title, t.created_by], [WS, "Routine: Plan posts", "owner1"]);
  assert.deepEqual(
    db.tables.messages.map((m) => [m.thread_id, m.workspace_id, m.role, m.agent, m.content]),
    [
      [t.id, WS, "user", null, "Plan next week's posts with /plan-weekly-posts"],
      [t.id, WS, "agent", "social", "Here is the plan."],
    ],
  );
  assert.deepEqual(db.tables.messages[0].meta, { routine: R1 });
  assert.equal(requests.length, 1);
  assert.match(requests[0].system[0].text, /^You are Aphrodite/);
  // Knowledge, Memory, the skills list and the skill the instruction picked.
  const extra = requests[0].system[1].text;
  assert.match(extra, /Open 7 to 3\./);
  assert.match(extra, /- Closed on Mondays\. \(2026-11-02\)/);
  assert.match(extra, /- plan-weekly-posts: /);
  assert.match(extra, /The person picked the skill "plan-weekly-posts"/);
  assert.deepEqual(
    requests[0].tools?.map((x) => x.name),
    ["log_progress", "remember", "search_knowledge", "set_goal", "set_plan", "show_card", "update_step", "use_skill", "handoff"],
  );
  assert.equal(routine().last_thread_id, t.id);
  assert.equal(routine().last_note, null);
  assert.equal(db.tables.ai_usage[0].workspace_id, WS);
});

test("run_routine: Iris, Hora, Hermes and Hestia take routines, with their own skills and the line on connecting apps", async () => {
  const gods = { email: "Iris", forms: "Hora", sales: "Hermes", support: "Hestia" } as const;
  const skill = { email: "write-a-campaign", forms: "reminder-emails", sales: "follow-up-new-leads", support: "daily-inbox-triage" } as const;
  for (const agent of Object.keys(gods) as (keyof typeof gods)[]) {
    requests = [];
    db.tables.threads = [];
    db.tables.messages = [];
    Object.assign(routine(), { agent, instruction: `Do the morning work with /${skill[agent]}`, last_note: "x" });
    db.tables.jobs = [routineJob()];
    await tick();
    assert.equal(requests.length, 1, agent);
    assert.match(requests[0].system[0].text, new RegExp(`^You are ${gods[agent]},`));
    // No Composio key in tests: the teammate is told apps aren't ready, so it works in chat.
    assert.match(requests[0].system[0].text, /connecting apps isn't ready yet, so do the work here in chat/, agent);
    assert.match(requests[0].system[0].text, /If the app you need isn't connected, say which one to connect in Settings, Apps\./, agent);
    assert.match(requests[0].system[1].text, new RegExp(`The person picked the skill "${skill[agent]}"`), agent);
    assert.deepEqual(
      requests[0].tools?.map((x) => x.name),
      ["log_progress", "remember", "search_knowledge", "set_goal", "set_plan", "show_card", "update_step", "use_skill", "handoff"],
      agent,
    );
    assert.equal(routine().last_note, null, agent);
    assert.deepEqual(db.tables.messages.map((m) => m.agent), [null, agent]);
  }
});

test("run_routine skips, with a note and no chat or AI, when the teammate is paused", async () => {
  db.tables.agent_prefs = [{ workspace_id: WS, agent: "social", enabled: false, trust: 0, model: "auto" }];
  db.tables.jobs = [routineJob()];
  const res = await tick();
  assert.deepEqual(await res.json(), { claimed: 1, done: 1, retry: 0, failed: 0 });
  assert.equal(routine().last_note, SKIP_NOTES.paused("social"));
  assert.equal(db.tables.threads.length, 0);
  assert.equal(requests.length, 0);
});

test("run_routine skips with a note when the AI allowance is used up or the trial ended", async () => {
  spent = 5;
  db.tables.jobs = [routineJob()];
  await tick();
  assert.equal(routine().last_note, `Skipped. ${CAP_MESSAGES.trialAllowance}`);
  assert.equal(db.tables.threads.length, 0);
  assert.equal(requests.length, 0);
  spent = 0;
  db.tables.workspaces[0].trial_ends_at = new Date(Date.now() - 864e5).toISOString();
  await tick();
  assert.equal(routine().last_note, `Skipped. ${CAP_MESSAGES.trialOver}`);
  assert.equal(requests.length, 0);
});

test("run_routine skips with a note when there is no Claude key yet", async () => {
  claude.client = null;
  db.tables.jobs = [routineJob()];
  await tick();
  assert.equal(routine().last_note, SKIP_NOTES.starting);
  assert.equal(db.tables.threads.length, 0);
});

test("run_routine does nothing for a routine paused or deleted since it was queued, or one from another workspace", async () => {
  routine().enabled = false;
  db.tables.jobs = [routineJob(), { ...routineJob(R_OTHER, WS), id: 8 }, { ...routineJob("not-a-uuid"), id: 9 }];
  const res = await tick();
  assert.deepEqual(await res.json(), { claimed: 3, done: 3, retry: 0, failed: 0 });
  assert.equal(db.tables.threads.length, 0);
  assert.equal(requests.length, 0);
  assert.equal(db.tables.routines.find((r) => r.id === R_OTHER)!.last_note, null);
});

// ─────────────── POST /api/chat ───────────────

const post = (user: string | null, body: Record<string, unknown>) =>
  chat.POST(new Request("https://app.test/api/chat", { method: "POST", headers: user ? { Authorization: `Bearer ${user}` } : {}, body: JSON.stringify({ workspaceId: WS, ...body }) }));

async function lines(res: Response) {
  assert.equal(res.status, 200);
  return (await res.text())
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
}

test("Run now: a new routine chat streams, with the routine's own words and teammate, and marks it run", async () => {
  const ev = await lines(await post("editor1", { text: "ignored", routineId: R1, threadId: "33333333-2222-4333-8444-555555555555" }));
  const id = ev[0].id;
  assert.deepEqual(
    ev.map((e) => e.type),
    ["thread", "route", "status", "message", "done"],
  );
  // A routine's teammate is picked by the routine, so the router isn't asked.
  assert.deepEqual(ev[1], { type: "route", agent: "social", how: "forced", reason: "Picked by you" });
  assert.deepEqual(ev[3], { type: "message", agent: "social", text: "Here is the plan." });
  const t = db.tables.threads.find((x) => x.id === id)!;
  assert.deepEqual([t.title, t.created_by], ["Routine: Plan posts", "editor1"]);
  assert.equal(db.tables.messages[0].content, "Plan next week's posts with /plan-weekly-posts");
  assert.deepEqual(db.tables.messages[0].meta, { routine: R1, user: "editor1@example.com" });
  assert.equal(routine().last_thread_id, id);
  assert.equal(routine().last_note, null);
  assert.ok(Date.now() - Date.parse(String(routine().last_run_at)) < 5000);
  assert.match(requests[0].system[0].text, /^You are Aphrodite/);
});

test("Run now: another workspace's routine is not found, viewers can't run one, and nothing is saved", async () => {
  const res = await post("editor1", { text: "x", routineId: R_OTHER });
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, CHAT_MESSAGES.badRoutine);
  assert.equal((await post("editor1", { text: "x", routineId: "nope" })).status, 404);
  assert.equal((await post("viewer1", { text: "x", routineId: R1 })).status, 403);
  assert.equal(db.tables.threads.length, 0);
  assert.equal(db.tables.messages.length, 0);
  assert.equal(requests.length, 0);
});

test("a skill picked with / goes into that turn for the teammate who has it, after the cached parts", async () => {
  await lines(await post("editor1", { text: "@Artemis /find-keywords for sourdough" }));
  const sys = requests[0].system;
  assert.match(sys[0].text, /^You are Artemis/);
  assert.match(sys[1].text, /Closed on Mondays/);
  assert.ok(sys[1].text.indexOf("<skills>") < sys[1].text.indexOf('picked the skill "find-keywords"'));
  // A workspace skill with the same name takes the place of ours.
  db.tables.skills = [{ id: "s1", workspace_id: WS, agent: "seo", name: "find-keywords", description: "Our way. Use it when x.", body: "# Our way\n\nAsk Ana first.", updated_at: "2026-11-01" }];
  await lines(await post("editor1", { text: "@Artemis /find-keywords" }));
  assert.match(requests[1].system[1].text, /Ask Ana first\./);
  assert.doesNotMatch(requests[1].system[1].text, /Real search data/);
  // Another workspace's skills never show.
  db.tables.skills = [{ id: "s2", workspace_id: OTHER, agent: null, name: "secret-sauce", description: "Theirs. Use it when x.", body: "Theirs", updated_at: "2026-11-01" }];
  await lines(await post("editor1", { text: "/secret-sauce" }));
  assert.doesNotMatch(requests[2].system[1].text, /secret-sauce/);
});

test("use_skill and remember from a chat: the skill's steps come back, a fact is saved once with its chat, a secret is refused", async () => {
  replies = [
    { content: [{ type: "tool_use", id: "a", name: "use_skill", input: { name: "write-a-post" } }, { type: "tool_use", id: "b", name: "remember", input: { fact: "The owner likes short posts." } }, { type: "tool_use", id: "c", name: "remember", input: { fact: "Our Instagram password is Crois5ant!" } }], stop_reason: "tool_use" },
    text("Done."),
  ];
  const ev = await lines(await post("editor1", { text: "@Aphrodite remember I like short posts and write one" }));
  const threadId = ev[0].id;
  const results = requests[1].messages.at(-1)!.content as { tool_use_id: string; content: string; is_error?: boolean }[];
  const by = Object.fromEntries(results.map((r) => [r.tool_use_id, r]));
  assert.match(by.a.content, /Use the skill "write-a-post"/);
  assert.equal(by.b.content, MEMORY_MESSAGES.saved);
  assert.deepEqual([by.c.content, by.c.is_error], [MEMORY_MESSAGES.secret, true]);
  const saved = db.tables.memories.filter((m) => m.fact === "The owner likes short posts.");
  assert.equal(saved.length, 1);
  assert.deepEqual([saved[0].workspace_id, saved[0].agent, saved[0].thread_id], [WS, null, threadId]);
  assert.ok(!db.tables.memories.some((m) => /password/.test(String(m.fact))));
  // The same fact again is not saved twice.
  replies = [call("remember", { fact: "the owner likes SHORT posts" }), text("Ok.")];
  await lines(await post("editor1", { text: "@Aphrodite again", threadId }));
  assert.equal(db.tables.memories.filter((m) => m.workspace_id === WS).length, 2);
  const again = requests[3].messages.at(-1)!.content as { content: string }[];
  assert.equal(again[0].content, MEMORY_MESSAGES.same);
});
