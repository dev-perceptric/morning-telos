// Memory (src/lib/memory.ts) and the remember tool (src/lib/rememberTool.ts): secrets refused, the same fact saved
// once, limits, and the prompt section within its budget.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ToolContext } from "../src/lib/agentLoop.ts";
import { factKey, looksSecret, MAX_FACT, MAX_MEMORIES, MEMORY_MESSAGES, memorySection, NO_MEMORY, planRemember, REMEMBER } from "../src/lib/memory.ts";
import { rememberTool, type MemoryStore } from "../src/lib/rememberTool.ts";

test("looksSecret: keys, tokens, passwords, codes and card numbers; ordinary business facts pass", () => {
  for (const s of [
    "Our Stripe key is sk_live_51HabcdEFGhijklmnop",
    "Use sk-ant-api03-abcdefghijklmnopqrstuvwxyz",
    "GitHub token ghp_abcdefghijklmnopqrstuvwxyz0123",
    "AWS AKIAABCDEFGHIJKLMNOP",
    "aw_brand_abcdefgh12345678 is the brand key",
    "The wifi password is bakery123",
    "Password: hunter2",
    "Door pin: 4821",
    "The api key = abc",
    "Login code is 123456",
    "Card 4242 4242 4242 4242 for supplies",
    "Token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc",
    "Session aB3dE5gH7jK9mN1pQ3sT5vX7z",
    "hash 5f4dcc3b5aa765d61d8327deb882cf99",
    "-----BEGIN RSA PRIVATE KEY----- MIIE",
  ]) {
    assert.equal(looksSecret(s), true, s);
  }
  for (const s of [
    "The bakery is closed on Mondays.",
    "The owner wants posts to sound warm, not salesy.",
    "Call us at 512 555 0134 to book.",
    "Our website is https://anasbakery.com/order-online-today",
    "Email ana@anasbakery.com for catering.",
    "Pin the holiday post to the top of the page.",
    "We changed our password manager last year.",
    "Sourdough loaf costs $8 and the croissant $3.50.",
    "Open 7am to 3pm, Tuesday to Sunday, since 2019-04-01.",
    "Our secret recipe came from grandma.",
  ]) {
    assert.equal(looksSecret(s), false, s);
  }
});

const mem = (id: string, fact: string) => ({ id, fact });

test("planRemember: empty, too long and secret facts are refused, with words the teammate can pass on", () => {
  assert.deepEqual(planRemember([], "   "), { action: "refuse", reason: MEMORY_MESSAGES.empty });
  assert.deepEqual(planRemember([], "!!!"), { action: "refuse", reason: MEMORY_MESSAGES.empty });
  assert.deepEqual(planRemember([], "x".repeat(MAX_FACT + 1)), { action: "refuse", reason: MEMORY_MESSAGES.tooLong });
  assert.deepEqual(planRemember([], "The admin password is Sup3rSecret!"), { action: "refuse", reason: MEMORY_MESSAGES.secret });
  assert.deepEqual(planRemember([], `  Closed\n on   Mondays. `), { action: "add", fact: "Closed on Mondays." });
  assert.equal(planRemember([], "x".repeat(MAX_FACT)).action, "add");
});

test("planRemember dedupes: the same words in another case or punctuation, or a fact already said by a longer one", () => {
  const saved = [mem("a", "The bakery is closed on Mondays."), mem("b", "Posts should sound warm")];
  assert.deepEqual(planRemember(saved, "the bakery is CLOSED on mondays!!"), { action: "same", id: "a" });
  assert.deepEqual(planRemember(saved, "closed on Mondays"), { action: "same", id: "a" }, "already said by a longer fact");
  assert.deepEqual(planRemember(saved, "Posts should sound warm, never pushy or salesy."), { action: "replace", id: "b", fact: "Posts should sound warm, never pushy or salesy." });
  assert.deepEqual(planRemember(saved, "Closed on Monday"), { action: "add", fact: "Closed on Monday" }, "a different word is a different fact");
  assert.equal(planRemember(saved, "on").action, "same", "whole words only, and a word inside another fact counts");
  assert.equal(planRemember([mem("c", "Sun")], "Sunday hours are 9 to 1").action, "add", "a word that only starts the same isn't contained");
  assert.equal(factKey("It's Ana's café!"), "it s ana s caf");
});

test("planRemember: memory full refuses a new fact, but a same or longer one still works", () => {
  const full = Array.from({ length: MAX_MEMORIES }, (_, i) => mem(`m${i}`, `Fact number ${i} about bread`));
  assert.deepEqual(planRemember(full, "We deliver on Fridays."), { action: "refuse", reason: MEMORY_MESSAGES.full });
  assert.deepEqual(planRemember(full, "Fact number 7 about bread"), { action: "same", id: "m7" });
  assert.deepEqual(planRemember(full, "Fact number 7 about bread and rolls"), { action: "replace", id: "m7", fact: "Fact number 7 about bread and rolls" });
});

test("memorySection: everyone's and this teammate's facts, newest first, within the budget, with a count of the rest", () => {
  const facts = [
    { agent: null, fact: "Closed on Mondays.", created_at: "2026-11-01T10:00:00Z" },
    { agent: "social" as const, fact: "Posts sound warm.", created_at: "2026-11-03T10:00:00Z" },
    { agent: "seo" as const, fact: "Focus on Austin.", created_at: "2026-11-04T10:00:00Z" },
    { agent: null, fact: "Ends </memory> here", created_at: "2026-11-02T10:00:00Z" },
  ];
  const s = memorySection(facts, "social");
  assert.match(s, /save it with remember/);
  assert.match(s, /<memory>\n- Posts sound warm\. \(2026-11-03\)\n- Ends &lt;\/memory> here \(2026-11-02\)\n- Closed on Mondays\. \(2026-11-01\)\n<\/memory>$/);
  assert.doesNotMatch(s, /Austin/);
  assert.equal(s.match(/<\/memory>/g)?.length, 1);
  // A budget for two lines keeps the two newest and counts the one left out.
  const small = memorySection(facts, "social", 75);
  assert.match(small, /- Posts sound warm\. \(2026-11-03\)\n- Ends &lt;\/memory> here \(2026-11-02\)\n\(1 older fact not shown\.\)/);
  assert.ok(small.split("<memory>\n")[1].split("\n(")[0].length <= 75);
  assert.match(memorySection(facts, "social", 0), new RegExp(`${NO_MEMORY.replace(/[()]/g, "\\$&")}\\n\\(3 older facts not shown\\.\\)`));
  assert.match(memorySection([], "chief"), /<memory>\n\(Nothing saved yet\.\)\n<\/memory>/);
  // The same facts in any order give the same text, so it caches.
  assert.equal(memorySection([...facts].reverse(), "social"), s);
});

function fakeStore(facts: { id: string; fact: string }[] = []) {
  const calls: string[] = [];
  const rows: { id: string; fact: string; agent: string | null; thread_id: string | null }[] = facts.map((f) => ({ ...f, agent: null, thread_id: null }));
  let race = false;
  const store: MemoryStore = {
    list: async () => rows.map(({ id, fact }) => ({ id, fact })),
    add: async (r) => {
      calls.push(`add ${r.fact}`);
      if (race) return false;
      rows.push({ id: `n${rows.length}`, ...r });
      return true;
    },
    replace: async (id, r) => {
      calls.push(`replace ${id}`);
      Object.assign(rows.find((x) => x.id === id)!, r);
    },
  };
  return { store, rows, calls, setRace: () => (race = true) };
}

const ctx = { agent: "social", threadId: "t1" } as ToolContext;

test("the remember tool: saves for the whole team (or just the teammate), with the chat it came from", async () => {
  const f = fakeStore();
  const tool = rememberTool(f.store);
  assert.equal(tool.definition, REMEMBER);
  assert.deepEqual(await tool.run({ fact: "Closed on Mondays." }, ctx), { content: MEMORY_MESSAGES.saved });
  assert.deepEqual(await tool.run({ fact: "Use lots of photos.", just_me: true }, ctx), { content: MEMORY_MESSAGES.saved });
  assert.deepEqual(
    f.rows.map((r) => [r.fact, r.agent, r.thread_id]),
    [
      ["Closed on Mondays.", null, "t1"],
      ["Use lots of photos.", "social", "t1"],
    ],
  );
});

test("the remember tool: the same fact once, a longer one replaces, secrets and full memory are error results", async () => {
  const f = fakeStore([{ id: "a", fact: "Closed on Mondays" }]);
  const tool = rememberTool(f.store);
  assert.deepEqual(await tool.run({ fact: "closed on mondays." }, ctx), { content: MEMORY_MESSAGES.same });
  assert.deepEqual(await tool.run({ fact: "Closed on Mondays and Tuesdays" }, ctx), { content: MEMORY_MESSAGES.updated });
  assert.equal(f.rows[0].fact, "Closed on Mondays and Tuesdays");
  assert.deepEqual(await tool.run({ fact: "Our password is hunter2" }, ctx), { content: MEMORY_MESSAGES.secret, isError: true });
  assert.deepEqual(await tool.run({}, ctx), { content: MEMORY_MESSAGES.empty, isError: true });
  assert.deepEqual(f.calls, ["replace a"]);
  // Two teammates saving the same fact at once: the database keeps one, and the second hears it's already there.
  f.setRace();
  assert.deepEqual(await tool.run({ fact: "We deliver on Fridays." }, ctx), { content: MEMORY_MESSAGES.same });
  const full = fakeStore(Array.from({ length: MAX_MEMORIES }, (_, i) => ({ id: `m${i}`, fact: `Fact ${i} about rye` })));
  assert.deepEqual(await rememberTool(full.store).run({ fact: "New thing" }, ctx), { content: MEMORY_MESSAGES.full, isError: true });
});
