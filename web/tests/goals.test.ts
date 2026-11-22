// Goals (src/lib/goals.ts) and the Monday check-in job (src/lib/goalCheckin.ts), with fakes: no database, no Claude.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { NewMessage, Pref, TeamStore, TeamWorkspace, TurnInput } from "../src/lib/agentLoop.ts";
import type { GoalPatch } from "../src/lib/cardTools.ts";
import { readCard } from "../src/lib/cards.ts";
import { checkinHandler, type CheckinDeps } from "../src/lib/goalCheckin.ts";
import { CHECKIN_LABEL, checkinPrompt, goalInsert, goalLine, goalOf, progressCard, startError, stepInserts, type GoalRow, goalPercent, goalsSummary } from "../src/lib/goals.ts";
import type { Job } from "../src/lib/jobs.ts";
import type { AgentKey } from "../src/lib/team.ts";
import { withSoon } from "./soon.ts";

const NOW = Date.parse("2026-11-23T15:00:00Z");
const WS: TeamWorkspace = { id: "11111111-2222-4333-8444-555555555555", name: "Ana's Bakery", website: "anasbakery.com", plan: "trial", status: "trialing", trial_ends_at: new Date(NOW + 10 * 864e5).toISOString(), period_start: new Date(NOW - 4 * 864e5).toISOString() };
const GOAL_ID = "99999999-8888-4777-8666-555555555555";
const THREAD = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const goal = (over: Partial<GoalRow> = {}): GoalRow => ({
  id: GOAL_ID,
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
  current: 12,
  baseline: 1000,
  history: [{ at: "2026-11-16", value: 12 }],
  checked_at: null,
  created_at: "2026-11-14T12:00:00Z",
  ...over,
});
const job = (payload: Record<string, unknown> = { goal: GOAL_ID, week: "2026-11-23" }): Job => ({ id: 1, kind: "goal_checkin", workspace_id: WS.id, payload, attempts: 1, max_attempts: 1 });

function setup(o: { goal?: GoalRow | null; prefs?: Partial<Record<AgentKey, Partial<Pref>>>; spent?: number; client?: boolean; reading?: number | null; ws?: TeamWorkspace | null } = {}) {
  const notes: NewMessage[] = [];
  const turns: TurnInput[] = [];
  const saved: GoalPatch[] = [];
  const store: TeamStore = {
    history: async () => [],
    addMessage: async (m) => void notes.push(m),
    prefs: async () => o.prefs ?? {},
    recordUsage: async () => {},
    spendSince: async () => o.spent ?? 0,
    touchThread: async () => {},
  };
  const deps: CheckinDeps = {
    goal: async (ws, id) => (ws === WS.id && id === GOAL_ID ? (o.goal === undefined ? goal() : o.goal) : null),
    workspace: async () => (o.ws === undefined ? WS : o.ws),
    store: () => store,
    client: () => (o.client === false ? null : { beta: { messages: { create: async () => Promise.reject(new Error("not in this test")) } } }),
    reading: async () => (o.reading === undefined ? 1030 : o.reading),
    saveGoal: async (_ws, _id, p) => void saved.push(p),
    tools: () => async () => ({ tools: [], missing: [] }),
    context: () => async () => [],
    runTurn: async (input) => void turns.push(input),
    now: () => NOW,
  };
  return { deps, notes, turns, saved };
}

test("check-in: the owner reads today's number, a note goes in the goal's chat, and the owner's turn runs there", async () => {
  const s = setup();
  assert.deepEqual(await checkinHandler(s.deps)(job()), { status: "done" });
  assert.equal(s.saved.length, 1);
  assert.equal(s.saved[0].current, 30, "1030 followers, up 30 from where the goal started");
  assert.equal(s.notes.length, 1);
  const n = s.notes[0];
  assert.deepEqual({ role: n.role, agent: n.agent, thread: n.thread_id, ws: n.workspace_id, meta: n.meta }, { role: "note", agent: "social", thread: THREAD, ws: WS.id, meta: { checkin: GOAL_ID, week: "2026-11-23" } });
  assert.match(n.content, /Weekly check-in for the goal "Grow LinkedIn by 150 followers by Jan 31"\. It stands at 30 of 150 followers\./);
  assert.match(n.content, /call log_progress first, then say the number, what the team did this week, and the one change for next week/);
  assert.equal(s.turns.length, 1);
  assert.deepEqual({ thread: s.turns[0].threadId, forced: s.turns[0].forced, text: s.turns[0].text }, { thread: THREAD, forced: "social", text: n.content });
});

test("check-in: a goal no product measures skips the reading; skipped when done, stopped, gone, paused, coming soon, no key or over the allowance", async () => {
  const other = setup({ goal: goal({ metric: "other", unit: "bookings" }) });
  await checkinHandler(other.deps)(job());
  assert.equal(other.saved.length, 0);
  assert.equal(other.turns.length, 1);

  const noRead = setup({ reading: null });
  await checkinHandler(noRead.deps)(job());
  assert.equal(noRead.saved.length, 0);
  assert.match(noRead.notes[0].content, /12 of 150/);

  for (const [name, s] of [
    ["done", setup({ goal: goal({ status: "done" }) })],
    ["stopped", setup({ goal: goal({ status: "stopped" }) })],
    ["deleted", setup({ goal: null })],
    ["no workspace", setup({ ws: null })],
    ["paused", setup({ prefs: { social: { enabled: false } } })],
    ["no key", setup({ client: false })],
    ["over the allowance", setup({ spent: 50 })],
  ] as const) {
    assert.deepEqual(await checkinHandler(s.deps)(job()), { status: "done" }, name);
    assert.equal(s.turns.length, 0, name);
    assert.equal(s.notes.length, 0, name);
  }
  const soon = setup();
  await withSoon("social", async () => {
    await checkinHandler(soon.deps)(job());
  });
  assert.equal(soon.turns.length, 0);
  assert.deepEqual(await checkinHandler(setup().deps)(job({ goal: "nope" })), { status: "failed", error: "A goal_checkin job needs a workspace and a goal." });
});

test("goal rows read as numbers, the progress card is built from the row, and the check-in note shows one short line", () => {
  const g = goalOf({ ...goal(), target: "150", current: "12.5", baseline: null, history: [{ at: "2026-11-16", value: "12" }, { bad: true }], due_date: "2027-01-31T00:00:00" } as unknown as Record<string, unknown>);
  assert.equal(g.target, 150);
  assert.equal(g.current, 12.5);
  assert.deepEqual(g.history, [{ at: "2026-11-16", value: 12 }]);
  assert.equal(g.due_date, "2027-01-31");
  assert.equal(goalLine(g, NOW), "Grow LinkedIn by 150 followers by Jan 31");
  const card = readCard(progressCard(goal({ current: 20 }), { now: NOW }), "social");
  assert.ok(card.ok);
  if (card.ok && card.card.kind === "progress") {
    assert.deepEqual({ current: card.card.current, start: card.card.start, due: card.card.due, points: card.card.points.length, status: card.card.status }, { current: 20, start: "2026-11-14", due: "2027-01-31", points: 1, status: "on_track" });
  }
  assert.equal(progressCard(goal({ current: 20 }), { now: NOW, pending: 1 }).status, "needs_you", "an approval waits in its chat");
  assert.equal(progressCard(goal({ current: 5 }), { now: NOW }).status, "needs_you", "behind the straight line to the due date");
  assert.equal(CHECKIN_LABEL, "Weekly check-in");
  assert.doesNotMatch(checkinPrompt(goal(), NOW), /—/);
});

// ─────────────── what the goal and plan cards insert ───────────────

/** The columns 024_goals.sql lets signed-in people insert into a table. */
function insertGrant(table: string): string[] {
  const sql = readFileSync(new URL("../supabase/024_goals.sql", import.meta.url), "utf8");
  const m = new RegExp(`grant insert \\(([^)]*)\\) on public\\.${table} to authenticated`).exec(sql);
  assert.ok(m, `no insert grant for ${table}`);
  return m[1].split(",").map((c) => c.trim());
}

test("goalInsert and stepInserts send only the columns people may insert, never created_by", () => {
  const g = goalInsert({ workspaceId: WS.id, threadId: THREAD, card: { id: "c_abcdef123456", agent: "social", metric: "followers", lead: "Grow LinkedIn by", unit: "followers" }, target: 150, due: "2027-01-31" });
  assert.deepEqual(g, { workspace_id: WS.id, thread_id: THREAD, card_id: "c_abcdef123456", agent: "social", metric: "followers", title: "Grow LinkedIn by", target: 150, unit: "followers", due_date: "2027-01-31" });
  const goalCols = insertGrant("goals");
  for (const k of Object.keys(g)) assert.ok(goalCols.includes(k), `goals.${k} isn't insertable`);
  const steps = stepInserts({ workspaceId: WS.id, threadId: THREAD, goalId: GOAL_ID, planId: "c_plan12345678", steps: [{ title: "Learn the brand", agent: "social" }, { title: "Find topics", agent: "seo" }] });
  assert.deepEqual(steps.map((s) => [s.position, s.title, s.agent]), [[1, "Learn the brand", "social"], [2, "Find topics", "seo"]]);
  const stepCols = insertGrant("goal_steps");
  for (const s of steps) for (const k of Object.keys(s)) assert.ok(stepCols.includes(k), `goal_steps.${k} isn't insertable`);
  assert.ok(!("created_by" in g) && steps.every((s) => !("created_by" in s)));
});

test("startError says 'not set up' only when the table is missing, and never shows the database's words", () => {
  assert.equal(startError({ code: "42P01", message: 'relation "goals" does not exist' }, "goal"), "Goals aren't set up on the server yet.");
  assert.equal(startError({ code: "PGRST205", message: "Could not find the table 'public.goal_steps'" }, "plan"), "Plans aren't set up on the server yet.");
  assert.equal(startError({ code: "42501", message: "permission denied for table goals" }, "goal"), "We couldn't start the goal. Try again.");
  assert.equal(startError({ code: "42501", message: "permission denied for table goal_steps" }, "plan"), "We couldn't start the plan. Try again.");
});

test("goalPercent: from the start to the target, never past 0 or 100", () => {
  assert.equal(goalPercent({ current: 50, target: 100, baseline: null, status: "active" }), 50);
  assert.equal(goalPercent({ current: 1200, target: 2000, baseline: 1000, status: "active" }), 20);
  assert.equal(goalPercent({ current: 900, target: 2000, baseline: 1000, status: "active" }), 0);
  assert.equal(goalPercent({ current: 2500, target: 2000, baseline: 1000, status: "active" }), 100);
  assert.equal(goalPercent({ current: 3, target: 100, baseline: null, status: "done" }), 100);
  assert.equal(goalPercent({ current: 5, target: 5, baseline: 5, status: "active" }), 100);
});

test("goalsSummary: one plain line for Alexander", () => {
  assert.equal(goalsSummary([]), null);
  assert.equal(goalsSummary(["on_track"]), "1 goal in progress.");
  assert.equal(goalsSummary(["on_track", "needs_you", "needs_you", "done"]), "3 goals in progress, 2 need you, 1 done.");
});
