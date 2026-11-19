// The reply being written, as the chat screen follows the stream (src/lib/liveReply.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChatEvent } from "../src/lib/agentLoop.ts";
import { IDLE, LIVE_WORDS, started, step, type Live } from "../src/lib/liveReply.ts";

const run = (s: Live, events: ChatEvent[]) => events.reduce(step, s);

test("right after Send: the teammate when known, else finding the right one", () => {
  assert.deepEqual(started("social"), { answering: "social", text: "", line: "Aphrodite is answering", used: [] });
  assert.deepEqual(started(null), { answering: null, text: "", line: "Finding the right teammate", used: [] });
});

test("route, then deltas: the line names who answers, then the text takes its place as it grows", () => {
  let s = run(started(null), [{ type: "thread", id: "t" }, { type: "route", agent: "seo", how: "router", reason: "SEO" }]);
  assert.equal(s.line, "Artemis is answering");
  s = step(s, { type: "status", agent: "seo", text: "Thinking" });
  assert.equal(s.line, "Artemis is answering");
  s = run(s, [
    { type: "delta", agent: "seo", text: "Traffic ", start: true },
    { type: "delta", agent: "seo", text: "is up." },
  ]);
  assert.deepEqual(s, { answering: "seo", text: "Traffic is up.", line: null, used: [] });
  assert.deepEqual(step(s, { type: "message", agent: "seo", text: "Traffic is up." }), IDLE);
});

test("tools: the progress line updates, the used list grows once per tool, and a new step's text starts over", () => {
  const s = run(started("seo"), [
    { type: "delta", agent: "seo", text: "Let me look.", start: true },
    { type: "tool", agent: "seo", text: "SEO and AI visibility: domain overview", line: "Artemis is checking katalon.com", used: "domain overview" },
    { type: "tool", agent: "seo", text: "SEO and AI visibility: keyword research", line: "Artemis is researching keywords", used: "keyword research" },
    { type: "tool", agent: "seo", text: "SEO and AI visibility: domain overview", line: "Artemis is checking katalon.com", used: "domain overview" },
    { type: "status", agent: "seo", text: "Working" },
  ]);
  assert.equal(s.line, "Artemis is checking katalon.com", "the tool line stays between steps");
  assert.deepEqual(s.used, ["domain overview", "keyword research"]);
  assert.equal(s.text, "Let me look.");
  const next = step(s, { type: "delta", agent: "seo", text: "katalon.com gets", start: true });
  assert.equal(next.text, "katalon.com gets");
  assert.equal(next.line, null);
});

test("a tool event from an older server, with only its label, still shows a line", () => {
  assert.equal(step(started("seo"), { type: "tool", agent: "seo", text: "Searching Knowledge" }).line, "Searching Knowledge");
});

test("a handoff: the next teammate is answering, with a fresh reply", () => {
  const s = run(started("chief"), [
    { type: "delta", agent: "chief", text: "Over to Artemis.", start: true },
    { type: "message", agent: "chief", text: "Over to Artemis." },
    { type: "handoff", from: "chief", to: "seo", note: "Check" },
  ]);
  assert.deepEqual(s, { answering: "seo", text: "", line: "Artemis is answering", used: [] });
  // A delta from someone else than who was answering starts a new reply too.
  assert.equal(step({ ...s, text: "old" }, { type: "delta", agent: "web", text: "New" }).text, "New");
});

test("the screen's words are plain, short and have no em dashes", () => {
  for (const w of [LIVE_WORDS.finding, LIVE_WORDS.askElse, LIVE_WORDS.jump, LIVE_WORDS.copy, LIVE_WORDS.copied, LIVE_WORDS.retry, LIVE_WORDS.stop, LIVE_WORDS.answering("social")]) {
    assert.doesNotMatch(w, /[–—]/);
    assert.ok(w.split(" ").length <= 5, w);
  }
});
