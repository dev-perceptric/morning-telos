// Theseus's Visibility tab (src/lib/seoWork.ts): reading Arrowsterr's answers, the once-a-day copy, the waiting
// items, the question limit, and the person's own changes. Every dependency is a fake: no Arrowsterr, no database.
import assert from "node:assert/strict";
import test from "node:test";
import {
  planOf,
  questionsOf,
  readJson,
  SEO_MESSAGES,
  seoAct,
  seoAnswers,
  seoSummary,
  seoWork,
  stale,
  TAB_TOPIC,
  visibilityOf,
  waitingOf,
  type SeoData,
} from "../src/lib/seoWork.ts";

const rank = { viewer: 1, editor: 2, admin: 3, owner: 4 };
const gateAt = (role: keyof typeof rank) => async (min: keyof typeof rank) =>
  rank[role] >= rank[min] ? { ok: true as const, userId: "u1" } : { ok: false as const, status: 403, error: "Not allowed." };

const VIS = { brand: { name: "Perceptric" }, answers: 120, visibility: 18.4, visibilityBefore: 12, byModel: [{ model: "ChatGPT", visibility: 15 }, { model: "Perplexity", visibility: 31 }, { model: "Gemini", visibility: 0 }], topCompetitors: [{ name: "Rankwise", visibility: 31.2 }] };
const PROMPTS = { prompts: [{ prompt: "best seo agency austin", topic: "Agencies", visibility: 66.7, position: 2, latest: { ChatGPT: "#2", Gemini: "not named" }, mostNamed: ["Rankwise", "Perceptric"] }, { prompt: "" }, null] };
const PLAN = { items: [{ id: "c1", keyword: "ai seo audit", status: "writing", volume: 1900, difficulty: 22, notes: null, url: null }, { keyword: "" }] };

test("readJson takes the JSON after Arrowsterr's summary line", () => {
  assert.deepEqual(readJson('Added 1 of 1 to the Content Plan.\n\n{"added":1}'), { added: 1 });
  assert.deepEqual(readJson('{"a":[1]}'), { a: [1] });
  assert.equal(readJson("No tracked prompt matches."), null);
  assert.equal(readJson("{broken"), null);
  assert.equal(readJson(null), null);
});

test("visibilityOf, questionsOf and planOf keep what the tab shows, and drop empty rows", () => {
  assert.deepEqual(visibilityOf(VIS), { visibility: 18.4, before: 12, byModel: [{ model: "ChatGPT", visibility: 15 }, { model: "Perplexity", visibility: 31 }, { model: "Gemini", visibility: 0 }], topCompetitor: { name: "Rankwise", visibility: 31.2 } });
  assert.equal(visibilityOf(null), null);
  assert.deepEqual(questionsOf(PROMPTS), [{ prompt: "best seo agency austin", topic: "Agencies", visibility: 66.7, position: 2, latest: { ChatGPT: "#2", Gemini: "not named" }, mostNamed: ["Rankwise", "Perceptric"] }]);
  assert.deepEqual(planOf(PLAN), [{ id: "c1", keyword: "ai seo audit", status: "writing", volume: 1900, difficulty: 22, notes: null, url: null }]);
  assert.deepEqual(questionsOf(null), []);
  assert.deepEqual(planOf({ items: "nope" }), []);
});

test("waitingOf: Theseus's pending questions and topics, nothing else", () => {
  const w = waitingOf([
    { id: 3, tool: "add_prompts", status: "pending", input: { topic: "Local", prompts: ["plumber seo checklist", "", 5] } },
    { id: 4, tool: "add_to_content_plan", status: "pending", input: { items: [{ keyword: "plumber seo", volume: 880 }, { notes: "no keyword" }] } },
    { id: 5, tool: "remove_from_content_plan", status: "pending", input: { ids: ["c1"] } },
    { id: 6, tool: "add_prompts", status: "done", input: { topic: "Old", prompts: ["old one"] } },
  ]);
  assert.deepEqual(w.questions.map((q) => [q.prompt, q.topic, q.wait]), [["plumber seo checklist", "Local", { approvalId: 3 }]]);
  assert.deepEqual(w.plan.map((t) => [t.keyword, t.volume, t.wait]), [["plumber seo", 880, { approvalId: 4 }]]);
});

test("seoSummary: one plain line, or nothing before the first check", () => {
  assert.equal(seoSummary(visibilityOf(VIS)), "AI tools named you in 18% of answers in the last 30 days, up from 12%. Perplexity names you most. Rankwise shows up in 31%.");
  assert.equal(seoSummary({ visibility: 10, before: 10.2, byModel: [], topCompetitor: null }), "AI tools named you in 10% of answers in the last 30 days.");
  assert.equal(seoSummary({ visibility: 5, before: 9, byModel: [{ model: "ChatGPT", visibility: 0 }], topCompetitor: null }), "AI tools named you in 5% of answers in the last 30 days, down from 9%.");
  assert.equal(seoSummary(null), null);
  assert.equal(seoSummary({ visibility: null, before: null, byModel: [], topCompetitor: null }), null);
});

test("stale: read again after 20 hours", () => {
  const now = Date.parse("2027-01-02T12:00:00Z");
  assert.equal(stale(null, now), true);
  assert.equal(stale("2027-01-02T00:00:00Z", now), false);
  assert.equal(stale("2027-01-01T15:00:00Z", now), true);
});

// ─────────────── GET: the tab, from the daily copy ───────────────

const NOW = Date.parse("2027-01-02T12:00:00Z");
function deps(o: { status?: string | null; saved?: { data: SeoData; fetchedAt: string } | null; reads?: Record<string, unknown>; limit?: number; gate?: ReturnType<typeof gateAt> } = {}) {
  const calls: string[] = [];
  const box = { saved: o.saved ?? null, sets: 0 };
  const reads = o.reads ?? { get_ai_visibility: VIS, get_prompts: PROMPTS, get_content_plan: PLAN };
  return {
    calls,
    box,
    deps: {
      gate: o.gate ?? gateAt("viewer"),
      serviceStatus: async () => (o.status === undefined ? "ready" : o.status),
      read: async (tool: string) => {
        calls.push(tool);
        const v = reads[tool];
        return v === undefined || v === null ? null : JSON.stringify(v);
      },
      cache: {
        get: async () => box.saved,
        set: async (data: SeoData) => {
          box.sets++;
          box.saved = { data, fetchedAt: new Date(NOW).toISOString() };
        },
        clear: async () => void (box.saved = null),
      },
      approvals: async () => [{ id: 3, tool: "add_prompts", status: "pending", input: { topic: "Local", prompts: ["plumber seo checklist"] } }],
      limit: async () => o.limit ?? 15,
      now: () => NOW,
    },
  };
}

test("seoWork reads Arrowsterr once, saves it, and the next visit costs nothing", async () => {
  const s = deps();
  const first = await seoWork(s.deps);
  assert.equal(first.status, 200);
  assert.equal(first.body.ready, true);
  assert.equal(first.body.summary, "AI tools named you in 18% of answers in the last 30 days, up from 12%. Perplexity names you most. Rankwise shows up in 31%.");
  assert.deepEqual((first.body.questions as { prompt: string }[]).map((q) => q.prompt), ["best seo agency austin", "plumber seo checklist"]);
  assert.deepEqual((first.body.plan as { keyword: string }[]).map((t) => t.keyword), ["ai seo audit"]);
  assert.equal(first.body.limit, 15);
  assert.deepEqual(first.body.approvals, [{ id: 3, tool: "add_prompts" }]);
  assert.deepEqual(s.calls, ["get_ai_visibility", "get_prompts", "get_content_plan"]);
  await seoWork(s.deps);
  assert.equal(s.calls.length, 3, "the second visit used the saved copy");
  assert.equal(s.box.sets, 1);
});

test("seoWork reads again once the copy is a day old, and keeps the old copy when the read fails", async () => {
  const old = { data: { visibility: null, questions: [{ prompt: "old q", topic: "", visibility: null, position: null, latest: {}, mostNamed: [] }], plan: [] }, fetchedAt: "2027-01-01T08:00:00Z" };
  const s = deps({ saved: old });
  await seoWork(s.deps);
  assert.equal(s.calls.length, 3);
  const down = deps({ saved: old, reads: {} });
  const out = await seoWork(down.deps);
  assert.equal(out.body.fetchedAt, "2027-01-01T08:00:00Z");
  assert.deepEqual((out.body.questions as { prompt: string }[]).map((q) => q.prompt), ["old q", "plumber seo checklist"]);
  assert.equal(down.box.sets, 0);
});

test("seoWork: a brand before its first check is empty and isn't saved; before setup only the waiting ones show", async () => {
  const s = deps({ reads: {} });
  const out = await seoWork(s.deps);
  assert.equal(out.body.ready, true);
  assert.equal(out.body.summary, null);
  assert.equal(out.body.fetchedAt, null);
  assert.equal(s.box.sets, 0);
  const setup = deps({ status: "provisioning" });
  const pre = await seoWork(setup.deps);
  assert.equal(pre.body.ready, false);
  assert.equal(setup.calls.length, 0, "nothing read before Arrowsterr is ready");
  assert.equal((await seoWork(deps({ gate: gateAt("viewer"), status: "ready" }).deps)).status, 200);
});

test("seoAnswers: each AI tool's answer to one question", async () => {
  const s = deps({
    reads: {
      get_prompt_answers: { prompt: "best seo agency austin", answers: [{ model: "ChatGPT", brandRank: 2, brandsNamed: ["1. Rankwise", "2. Perceptric (you)"], sitesCited: ["https://clutch.co/x"], text: "Top picks..." }, { model: "Gemini", brandRank: null }] },
    },
  });
  const out = await seoAnswers("best seo", s.deps);
  assert.equal(out.status, 200);
  assert.deepEqual(out.body, {
    prompt: "best seo agency austin",
    answers: [
      { model: "ChatGPT", rank: 2, named: ["1. Rankwise", "2. Perceptric (you)"], sites: ["https://clutch.co/x"], text: "Top picks..." },
      { model: "Gemini", rank: null, named: [], sites: [], text: null },
    ],
  });
  assert.deepEqual(await seoAnswers("  ", s.deps), { status: 400, body: { error: SEO_MESSAGES.question } });
  assert.deepEqual(await seoAnswers("nope", deps({ reads: {} }).deps), { status: 502, body: { error: SEO_MESSAGES.answers } });
});

// ─────────────── POST: the person's own changes ───────────────

function act(o: { role?: keyof typeof rank; tracked?: number; limit?: number; write?: { ok: boolean; text: string } } = {}) {
  const writes: [string, Record<string, unknown>][] = [];
  const lines: string[] = [];
  let cleared = 0;
  return {
    writes,
    lines,
    cleared: () => cleared,
    deps: {
      gate: gateAt(o.role ?? "editor"),
      write: async (tool: string, input: Record<string, unknown>) => (writes.push([tool, input]), o.write ?? { ok: true, text: "{}" }),
      tracked: async () => o.tracked ?? 3,
      limit: async () => o.limit ?? 15,
      clearCache: async () => void cleared++,
      activity: async (t: string) => void lines.push(t),
    },
  };
}

test("seoAct: track, add, move and remove run in Arrowsterr, clear the copy and are logged", async () => {
  const s = act();
  for (const b of [
    { action: "track", question: " best seo agency austin " },
    { action: "add_topic", keyword: "Plumber SEO", notes: "A checklist" },
    { action: "status", id: "c1", status: "writing" },
    { action: "remove_topic", id: "c1" },
  ])
    assert.deepEqual(await seoAct(b, s.deps), { status: 200, body: { ok: true } });
  assert.deepEqual(s.writes, [
    ["add_prompts", { topic: TAB_TOPIC, prompts: ["best seo agency austin"] }],
    ["add_to_content_plan", { items: [{ keyword: "Plumber SEO", notes: "A checklist" }] }],
    ["update_content_plan", { items: [{ id: "c1", status: "writing" }] }],
    ["remove_from_content_plan", { ids: ["c1"] }],
  ]);
  assert.equal(s.cleared(), 4);
  assert.deepEqual(s.lines, ["You started tracking a question.", "You added a topic to the content plan.", "You moved a topic to writing.", "You removed a topic from the content plan."]);
});

test("seoAct: the plan's question limit, viewers, and bad input never reach Arrowsterr", async () => {
  const full = act({ tracked: 15, limit: 15 });
  assert.deepEqual(await seoAct({ action: "track", question: "one more" }, full.deps), { status: 409, body: { error: SEO_MESSAGES.full(15) } });
  const ended = act({ tracked: 0, limit: 0 });
  assert.deepEqual(await seoAct({ action: "track", question: "q" }, ended.deps), { status: 409, body: { error: SEO_MESSAGES.full(0) } });
  const viewer = act({ role: "viewer" });
  assert.equal((await seoAct({ action: "remove_topic", id: "c1" }, viewer.deps)).status, 403);
  const s = act();
  const cases: [Record<string, unknown>, string][] = [
    [{ action: "track", question: " " }, SEO_MESSAGES.question],
    [{ action: "track", question: "x".repeat(301) }, SEO_MESSAGES.questionLong],
    [{ action: "add_topic", keyword: "" }, SEO_MESSAGES.keyword],
    [{ action: "status", id: "c1", status: "done" }, SEO_MESSAGES.status],
    [{ action: "status", status: "writing" }, SEO_MESSAGES.topic],
    [{ action: "remove_topic" }, SEO_MESSAGES.topic],
    [{ action: "delete_everything" }, SEO_MESSAGES.action],
  ];
  for (const [b, error] of cases) assert.deepEqual(await seoAct(b, s.deps), { status: 400, body: { error } }, error);
  assert.equal(full.writes.length + ended.writes.length + viewer.writes.length + s.writes.length, 0);
});

test("seoAct: Arrowsterr's refusal comes back as the error, and the copy is kept", async () => {
  const s = act({ write: { ok: false, text: "No more prompts fit. This account's prompt limit is reached." } });
  assert.deepEqual(await seoAct({ action: "track", question: "q" }, s.deps), { status: 502, body: { error: "No more prompts fit. This account's prompt limit is reached." } });
  assert.equal(s.cleared(), 0);
  assert.deepEqual(s.lines, []);
});
