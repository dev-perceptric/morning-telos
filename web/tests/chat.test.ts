// The chat request, the NDJSON stream and the reply text pieces (src/lib/chat.ts), and thread titles (teamStore.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { CHAT_MESSAGES, inlineParts, MAX_MESSAGE, ndjsonLine, rateLimiter, readChat, readLines } from "../src/lib/chat.ts";
import { isUuid, threadTitle } from "../src/lib/teamStore.ts";

test("readChat: trims the text, keeps known agents and models, drops the rest", () => {
  assert.deepEqual(readChat({ text: "  hi  ", threadId: "t", agent: "seo", model: "haiku" }), { ok: true, value: { text: "hi", threadId: "t", agent: "seo", model: "haiku", routineId: null, again: false } });
  assert.deepEqual(readChat({ text: "hi", agent: "zeus", model: "gpt", threadId: 5 }), { ok: true, value: { text: "hi", threadId: null, agent: null, model: null, routineId: null, again: false } });
  assert.deepEqual(readChat({ text: "hi", routineId: "r1" }), { ok: true, value: { text: "hi", threadId: null, agent: null, model: null, routineId: "r1", again: false } });
  assert.deepEqual(readChat({ text: "   " }), { ok: false, error: CHAT_MESSAGES.empty });
  assert.deepEqual(readChat({}), { ok: false, error: CHAT_MESSAGES.empty });
  assert.deepEqual(readChat({ text: "x".repeat(MAX_MESSAGE + 1) }), { ok: false, error: CHAT_MESSAGES.tooLong });
  assert.equal(readChat({ text: "x".repeat(MAX_MESSAGE) }).ok, true);
});

test("readChat: again (Retry, Ask someone else) needs a thread, is only true, and never goes with a routine", () => {
  const v = (b: Record<string, unknown>) => {
    const r = readChat({ text: "hi", ...b });
    assert.ok(r.ok);
    return r.value.again;
  };
  assert.equal(v({ threadId: "t", again: true }), true);
  assert.equal(v({ again: true }), false);
  assert.equal(v({ threadId: "t", again: "yes" }), false);
  assert.equal(v({ threadId: "t", routineId: "r", again: true }), false);
});

test("ndjson: the new events (route, delta, stopped message) go through the reader whole", () => {
  const evs = [
    { type: "route", agent: "social", how: "router", reason: "Social media" },
    { type: "delta", agent: "social", text: "Hi \"there\"\n", start: true },
    { type: "message", agent: "social", text: "Hi", stopped: true, used: ["domain overview"] },
  ] as const;
  const all = evs.map((e) => ndjsonLine(e)).join("");
  assert.deepEqual(readLines(all).events, evs);
});

test("ndjson: each event is one line, and the reader keeps a half line for the next chunk", () => {
  const all = ndjsonLine({ type: "thread", id: "t1" }) + ndjsonLine({ type: "status", agent: "chief", text: "Thinking" }) + ndjsonLine({ type: "done" });
  assert.equal(all.split("\n").length, 4);
  const cut = all.length - 5;
  const a = readLines(all.slice(0, cut));
  assert.deepEqual(a.events, [
    { type: "thread", id: "t1" },
    { type: "status", agent: "chief", text: "Thinking" },
  ]);
  const b = readLines(a.rest + all.slice(cut));
  assert.deepEqual(b.events, [{ type: "done" }]);
  assert.equal(b.rest, "");
  assert.deepEqual(readLines('not json\n{"no":"type"}\n\n{"type":"done"}\n').events, [{ type: "done" }]);
});

test("rateLimiter: at most max per window, per key", () => {
  const limited = rateLimiter(2, 1000);
  assert.equal(limited("a", 0), false);
  assert.equal(limited("a", 10), false);
  assert.equal(limited("a", 20), true);
  assert.equal(limited("b", 20), false);
  assert.equal(limited("a", 1005), false, "the first one has left the window");
});

test("inlineParts: bold pieces, everything else plain text", () => {
  assert.deepEqual(inlineParts("Post **3 times** a week, **Monday** first."), [
    { text: "Post ", bold: false },
    { text: "3 times", bold: true },
    { text: " a week, ", bold: false },
    { text: "Monday", bold: true },
    { text: " first.", bold: false },
  ]);
  assert.deepEqual(inlineParts("<b>not html</b> **"), [{ text: "<b>not html</b> **", bold: false }]);
  assert.deepEqual(inlineParts(""), []);
});

test("threadTitle: one line, at most about 70 letters, cut at a word", () => {
  assert.equal(threadTitle("  Plan my\n\nweek  "), "Plan my week");
  const long = threadTitle("Please write three posts about our new sourdough bread and our holiday hours for December");
  assert.ok(long.length <= 73, long);
  assert.ok(long.endsWith("..."));
  assert.doesNotMatch(long, /\s\.\.\.$/);
  assert.equal(threadTitle("x".repeat(100)), `${"x".repeat(70)}...`);
});

test("isUuid", () => {
  assert.equal(isUuid("11111111-2222-4333-8444-555555555555"), true);
  assert.equal(isUuid("1; drop table"), false);
  assert.equal(isUuid(null), false);
});

test("loadWorkspace: the brand's tone comes with the workspace when the brand is on; no brand or no table means none", async () => {
  const { loadWorkspace } = await import("../src/lib/teamStore.ts");
  const { fakeDb } = await import("./server/fakeDb.ts");
  const WS = "11111111-2222-4333-8444-555555555555";
  const db = fakeDb();
  db.tables.workspaces = [{ id: WS, name: "Ana's Bakery", website: "anas.example", plan: "trial", status: null, trial_ends_at: "2026-12-01T00:00:00Z", period_start: null }];
  const load = () => loadWorkspace(db as never, WS);
  assert.equal((await load())?.tone, null);
  db.tables.brand_kits = [{ workspace_id: WS, tone: "Warm and simple", use_brand: true }];
  assert.equal((await load())?.tone, "warm and simple");
  db.tables.brand_kits = [{ workspace_id: WS, tone: "Warm and simple", use_brand: false }];
  assert.equal((await load())?.tone, null);
  // Another workspace's brand never comes along.
  db.tables.brand_kits = [{ workspace_id: "other", tone: "loud", use_brand: true }];
  assert.equal((await load())?.tone, null);
  assert.equal(await loadWorkspace(db as never, "missing"), null);
});

test("readChat: a message can be only files, and Retry can answer one; nothing at all is still empty", () => {
  assert.deepEqual(readChat({ text: "  ", files: ["x"] }), { ok: true, value: { text: "", threadId: null, agent: null, model: null, routineId: null, again: false } });
  assert.deepEqual(readChat({ text: "", threadId: "t", again: true }), { ok: true, value: { text: "", threadId: "t", agent: null, model: null, routineId: null, again: true } });
  assert.deepEqual(readChat({ text: "", files: [] }), { ok: false, error: CHAT_MESSAGES.empty });
  assert.deepEqual(readChat({ text: "", again: true }), { ok: false, error: CHAT_MESSAGES.empty }, "again needs a thread");
});
