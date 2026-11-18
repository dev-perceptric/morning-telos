// The chat request, the NDJSON stream and the reply text pieces (src/lib/chat.ts), and thread titles (teamStore.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { CHAT_MESSAGES, inlineParts, MAX_MESSAGE, ndjsonLine, rateLimiter, readChat, readLines } from "../src/lib/chat.ts";
import { isUuid, threadTitle } from "../src/lib/teamStore.ts";

test("readChat: trims the text, keeps known agents and models, drops the rest", () => {
  assert.deepEqual(readChat({ text: "  hi  ", threadId: "t", agent: "seo", model: "haiku" }), { ok: true, value: { text: "hi", threadId: "t", agent: "seo", model: "haiku" } });
  assert.deepEqual(readChat({ text: "hi", agent: "zeus", model: "gpt", threadId: 5 }), { ok: true, value: { text: "hi", threadId: null, agent: null, model: null } });
  assert.deepEqual(readChat({ text: "   " }), { ok: false, error: CHAT_MESSAGES.empty });
  assert.deepEqual(readChat({}), { ok: false, error: CHAT_MESSAGES.empty });
  assert.deepEqual(readChat({ text: "x".repeat(MAX_MESSAGE + 1) }), { ok: false, error: CHAT_MESSAGES.tooLong });
  assert.equal(readChat({ text: "x".repeat(MAX_MESSAGE) }).ok, true);
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
