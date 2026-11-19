// POST /api/chat with a fake database and a fake Claude (stubs/claude.ts). Nothing reaches Supabase or Anthropic.
// Run with: node --conditions=react-server --test tests/server/*.test.ts (part of npm test).

import assert from "node:assert/strict";
import { register } from "node:module";
import { beforeEach, test } from "node:test";
import { fakeDb } from "./fakeDb.ts";
import { claude, isRouter, routerReply } from "./stubs/claude.ts";
import { auth } from "./stubs/serverAuth.ts";

register("./tsResolve.mjs", import.meta.url);

const chat = await import("../../src/app/api/chat/route.ts");
const { CAP_MESSAGES } = await import("../../src/lib/meter.ts");
const { CHAT_MESSAGES } = await import("../../src/lib/chat.ts");

const WS = "11111111-2222-4333-8444-555555555555";
const OTHER = "11111111-2222-4333-8444-666666666666";
const OTHER_THREAD = "99999999-2222-4333-8444-555555555555";
const soon = new Date(Date.now() + 5 * 864e5).toISOString();

let db: ReturnType<typeof fakeDb>;
let spent: number;
let requests: { model: string; system: { text: string }[] }[];
/** Router requests, kept apart from the team's. */
let routed: { model: string; messages: { content: string }[] }[];
/** Who the fake router picks. */
let pick: string;

beforeEach(() => {
  db = fakeDb({}, { autoId: ["messages", "ai_usage"] });
  db.tables.workspaces = [
    { id: WS, name: "Ana's Bakery", website: "anasbakery.com", plan: "trial", status: "trialing", trial_ends_at: soon, period_start: new Date().toISOString() },
    { id: OTHER, name: "Other Co", website: null, plan: "trial", status: "trialing", trial_ends_at: soon, period_start: new Date().toISOString() },
  ];
  db.tables.threads = [{ id: OTHER_THREAD, workspace_id: OTHER, title: "Theirs" }];
  db.tables.messages = [];
  db.tables.agent_prefs = [];
  db.tables.ai_usage = [];
  spent = 0;
  db.rpcs.ai_spend = (a) => (a.p_ws === WS ? spent : 0);
  auth.db = db;
  auth.roles = new Map([
    [`editor1:${WS}`, "editor"],
    [`viewer1:${WS}`, "viewer"],
    [`owner2:${OTHER}`, "owner"],
  ]);
  requests = [];
  routed = [];
  pick = "Athena";
  claude.client = {
    beta: {
      messages: {
        create: async (p: { model: string; system: { text: string }[] }) => {
          if (isRouter(p)) {
            routed.push(p as unknown as (typeof routed)[number]);
            return routerReply(pick);
          }
          requests.push(p);
          return { id: "m", type: "message", role: "assistant", model: p.model, content: [{ type: "text", text: "Hello from your team." }], stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } };
        },
      },
    },
  };
});

const post = (user: string | null, body: Record<string, unknown>) =>
  chat.POST(new Request("https://app.test/api/chat", { method: "POST", headers: user ? { Authorization: `Bearer ${user}` } : {}, body: JSON.stringify({ workspaceId: WS, ...body }) }));

async function lines(res: Response) {
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/x-ndjson; charset=utf-8");
  assert.equal(res.headers.get("cache-control"), "no-store");
  const text = await res.text();
  assert.ok(text.endsWith("\n"));
  return text
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
}

test("viewers, strangers and signed-out people can't post, and nothing is saved", async () => {
  const v = await post("viewer1", { text: "hi" });
  assert.equal(v.status, 403);
  assert.match((await v.json()).error, /editor access/);
  assert.equal((await post("owner2", { text: "hi" })).status, 403, "an owner of another workspace");
  assert.equal((await post(null, { text: "hi" })).status, 401);
  assert.equal(db.writes.length, 0);
  assert.equal(requests.length, 0);
});

test("an editor's message starts a thread and streams NDJSON: thread, route, status, message, done", async () => {
  const ev = await lines(await post("editor1", { text: "  Plan my week  " }));
  assert.deepEqual(
    ev.map((e) => e.type),
    ["thread", "route", "status", "message", "done"],
  );
  const id = ev[0].id;
  assert.deepEqual(ev[1], { type: "route", agent: "chief", how: "router", reason: "Fits the job" });
  assert.deepEqual(ev[2], { type: "status", agent: "chief", text: "Thinking" });
  assert.deepEqual(ev[3], { type: "message", agent: "chief", text: "Hello from your team." });
  assert.deepEqual(db.tables.threads.find((t) => t.id === id), { id, workspace_id: WS, title: "Plan my week", created_by: "editor1", updated_at: db.tables.threads.find((t) => t.id === id)!.updated_at });
  assert.deepEqual(
    db.tables.messages.map((m) => [m.thread_id, m.workspace_id, m.role, m.agent, m.content]),
    [
      [id, WS, "user", null, "Plan my week"],
      [id, WS, "agent", "chief", "Hello from your team."],
    ],
  );
  assert.deepEqual(db.tables.messages[0].meta, { user: "editor1@example.com" });
  // Two calls metered: the router (no agent, Haiku) and Athena's answer.
  assert.equal(routed.length, 1);
  assert.equal(routed[0].model, "claude-haiku-5-5");
  assert.equal(db.tables.ai_usage.length, 2);
  assert.deepEqual(
    db.tables.ai_usage.map((u) => [u.workspace_id, u.thread_id, u.agent, u.model, u.cost_usd]),
    [
      [WS, id, null, "claude-haiku-5-5", 0.00005],
      [WS, id, "chief", "claude-opus-5-5", 0.0008],
    ],
  );
  assert.match(requests[0].system[0].text, /AI team of Ana's Bakery \(anasbakery\.com\)/);
});

test("a second message goes on the same thread, and the agent sees the earlier ones", async () => {
  const first = await lines(await post("editor1", { text: "Hi" }));
  const threadId = first[0].id;
  const ev = await lines(await post("editor1", { text: "@Artemis and you?", threadId }));
  assert.equal(ev[0].id, threadId);
  assert.equal(db.tables.threads.filter((t) => t.workspace_id === WS).length, 1);
  assert.equal(db.tables.messages.length, 4);
  // Artemis answers. Athena's earlier reply comes to her as user text.
  assert.match(requests[1].system[0].text, /^You are Artemis/);
});

test("another workspace's thread is not found, and nothing is saved", async () => {
  const res = await post("editor1", { text: "hi", threadId: OTHER_THREAD });
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, CHAT_MESSAGES.badThread);
  assert.equal((await post("editor1", { text: "hi", threadId: "not-a-uuid" })).status, 404);
  assert.equal(db.tables.messages.length, 0);
});

test("an empty message is turned away before anything is saved", async () => {
  const res = await post("editor1", { text: "   " });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, CHAT_MESSAGES.empty);
  assert.equal(db.writes.length, 0);
});

test("missing ANTHROPIC_API_KEY: the stream says the team is starting up, and nothing crashes", async () => {
  claude.client = null;
  const ev = await lines(await post("editor1", { text: "Hi" }));
  assert.deepEqual(
    ev.map((e) => e.type),
    ["thread", "message", "done"],
  );
  assert.deepEqual(ev[1], { type: "message", agent: "chief", text: CAP_MESSAGES.startingUp, blocked: "starting" });
  assert.equal(db.tables.messages[1].content, "Your AI team is starting up. Please try again in a few minutes.");
});

test("the AI allowance: a workspace that used it gets the limit message, and no teammate is called", async () => {
  spent = 5;
  const ev = await lines(await post("editor1", { text: "Hi" }));
  assert.deepEqual(ev[1], { type: "message", agent: "chief", text: CAP_MESSAGES.trialAllowance, blocked: "allowance" });
  assert.equal(requests.length, 0);
  // The router runs alongside the allowance check, for speed. Its small call is still metered.
  assert.ok(routed.length <= 1);
  assert.ok(db.tables.ai_usage.every((u) => u.agent === null && u.model === "claude-haiku-5-5"));
});

test("an ended trial gets the trial message", async () => {
  db.tables.workspaces[0].trial_ends_at = new Date(Date.now() - 864e5).toISOString();
  const ev = await lines(await post("editor1", { text: "Hi" }));
  assert.equal(ev[1].text, CAP_MESSAGES.trialOver);
  assert.equal(requests.length, 0);
});

test("a database failure mid-turn ends the stream with one short line", async () => {
  db.rpcs.ai_spend = () => {
    throw new Error("boom");
  };
  const ev = await lines(await post("editor1", { text: "Hi" }));
  assert.deepEqual(ev.slice(1), [{ type: "message", agent: "chief", text: "Something went wrong. Try again in a moment.", error: true }, { type: "done" }]);
});

test("an untagged message goes to the teammate the router picks, who answers in place of Athena", async () => {
  pick = "Aphrodite";
  const ev = await lines(await post("editor1", { text: "Who's responsible for the social media here?" }));
  assert.deepEqual(ev[1], { type: "route", agent: "social", how: "router", reason: "Fits the job" });
  assert.match(requests[0].system[0].text, /^You are Aphrodite/);
  assert.match(routed[0].messages[0].content, /<new_message>\nWho's responsible for the social media here\?\n<\/new_message>/);
  assert.equal(db.tables.messages[1].agent, "social");
});

test("a broken router answer falls back to Athena", async () => {
  pick = "Zeus";
  const ev = await lines(await post("editor1", { text: "Hello there" }));
  assert.deepEqual(ev[1], { type: "route", agent: "chief", how: "fallback", reason: "Answers general questions" });
  assert.match(requests[0].system[0].text, /^You are Athena/);
});

test("again (Retry, Ask someone else): the last message is answered by the picked teammate, and nothing new is saved for the person", async () => {
  const first = await lines(await post("editor1", { text: "Check our traffic" }));
  const threadId = first[0].id;
  const before = db.tables.messages.length;
  const ev = await lines(await post("editor1", { text: "anything", threadId, agent: "seo", again: true }));
  assert.deepEqual(ev[1], { type: "route", agent: "seo", how: "forced", reason: "Picked by you" });
  assert.equal(routed.length, 1, "a picked teammate needs no router");
  const added = db.tables.messages.slice(before);
  assert.deepEqual(
    added.map((m) => [m.role, m.agent]),
    [["agent", "seo"]],
  );
  // Artemis answers the person's real last message, not the words sent with the retry.
  const said = JSON.stringify((requests.at(-1) as unknown as { messages: unknown }).messages);
  assert.match(said, /Check our traffic/);
  assert.doesNotMatch(said, /anything/);
});

test("again in another workspace's thread is not found, and nothing is saved", async () => {
  const res = await post("editor1", { text: "x", threadId: OTHER_THREAD, agent: "seo", again: true });
  assert.equal(res.status, 404);
  assert.equal(db.tables.messages.length, 0);
  assert.equal(requests.length, 0);
});

test("Stop: cancelling the stream stops the reply and saves what was written, marked stopped", async () => {
  let release!: () => void;
  const hold = new Promise<void>((r) => (release = r));
  claude.client = {
    beta: {
      messages: {
        create: async (p: unknown) => (isRouter(p) ? routerReply("Athena") : Promise.reject(new Error("the team streams"))),
        stream: (_p: unknown, o?: { signal?: AbortSignal }) => {
          let onText: (d: string, s: string) => void = () => {};
          let current: unknown;
          return {
            on(_e: string, l: (d: string, s: string) => void) {
              onText = l;
              return this;
            },
            get currentMessage() {
              return current;
            },
            async finalMessage() {
              current = { model: "claude-opus-5-5", usage: { input_tokens: 100, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } };
              onText("Here is the first part", "Here is the first part");
              release();
              await new Promise<void>((_r, reject) => o?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
              throw new Error("unreachable");
            },
          };
        },
      },
    },
  };
  const res = await post("editor1", { text: "Write a long plan" });
  const reader = res.body!.getReader();
  const seen: string[] = [];
  const decoder = new TextDecoder();
  // Read until the first words arrive, then press Stop.
  while (!seen.join("").includes("Here is the first part")) seen.push(decoder.decode((await reader.read()).value));
  await hold;
  await reader.cancel();
  for (let i = 0; i < 50 && db.tables.messages.length < 2; i++) await new Promise((r) => setTimeout(r, 5));
  const saved = db.tables.messages[1];
  assert.deepEqual([saved.role, saved.agent, saved.content], ["agent", "chief", "Here is the first part"]);
  assert.equal(saved.meta.stopped, true);
  assert.ok(db.tables.ai_usage.some((u) => u.agent === "chief" && u.output_tokens >= 6), "the stopped call is metered too");
});
