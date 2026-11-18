// Approvals (src/lib/approvals.ts): what counts as a change, checking a decision, and deciding with fake deps.
import assert from "node:assert/strict";
import { test } from "node:test";
import { approvalId, APPROVAL_MESSAGES, clip, decide, isWrite, MAX_INPUT_CHARS, readDecision, setPath, toolTitle, type Approval, type DecideDeps, type Decision } from "../src/lib/approvals.ts";

test("isWrite: annotations first, then the first word of the name", () => {
  // readOnlyHint true is a read, whatever the name says.
  assert.equal(isWrite({ name: "delete_cache_stats", annotations: { readOnlyHint: true } }), false);
  // readOnlyHint false or destructiveHint true is a change, whatever the name says.
  assert.equal(isWrite({ name: "generate_media", annotations: { readOnlyHint: false, destructiveHint: false } }), true);
  assert.equal(isWrite({ name: "get_thing", annotations: { readOnlyHint: false } }), true);
  assert.equal(isWrite({ name: "tidy", annotations: { destructiveHint: true } }), true);
  // No annotations: the verb decides.
  for (const n of ["create_posts", "add_prompts", "update_content_plan", "remove_from_content_plan", "publish-post", "Schedule.Post", "send_email", "upload_media"]) assert.equal(isWrite({ name: n }), true, n);
  for (const n of ["get_ai_visibility", "list_channels", "keyword_research", "search", "next_queue_slot"]) assert.equal(isWrite({ name: n }), false, n);
  assert.equal(isWrite({ name: "create_posts", annotations: null }), true);
});

test("toolTitle and readable labels", () => {
  assert.equal(toolTitle("create_posts"), "Create posts");
  assert.equal(toolTitle("create_posts", "Schedule posts"), "Schedule posts");
  assert.equal(toolTitle("", "  "), "A change");
});

test("readDecision: approve (maybe with edited details) or deny; anything else is refused", () => {
  assert.deepEqual(readDecision({ action: "deny", input: { x: 1 } }), { ok: true, value: { action: "deny" } });
  assert.deepEqual(readDecision({ action: "approve" }), { ok: true, value: { action: "approve", input: null } });
  assert.deepEqual(readDecision({ action: "approve", input: { text: "Hi" } }), { ok: true, value: { action: "approve", input: { text: "Hi" } } });
  assert.deepEqual(readDecision({ action: "run" }), { ok: false, error: APPROVAL_MESSAGES.badAction });
  for (const input of ["x", [1], 3]) assert.deepEqual(readDecision({ action: "approve", input }), { ok: false, error: APPROVAL_MESSAGES.badInput });
  assert.deepEqual(readDecision({ action: "approve", input: { t: "x".repeat(MAX_INPUT_CHARS) } }), { ok: false, error: APPROVAL_MESSAGES.tooBig });
});

test("approvalId and clip", () => {
  assert.equal(approvalId("12"), 12);
  assert.equal(approvalId(7), 7);
  for (const v of ["0", "-1", "1.5", "abc", "", null, "9".repeat(20)]) assert.equal(approvalId(v), null, String(v));
  assert.equal(clip("abc", 5), "abc");
  assert.equal(clip("abcdef", 3), "abc\n...(3 more characters left out)");
});

test("setPath changes one field and leaves the rest", () => {
  const v = { posts: [{ text: "a", channel_ids: ["c1"] }, { text: "b" }], draft: true };
  const next = setPath(v, ["posts", 0, "text"], "Hello");
  assert.deepEqual(next, { posts: [{ text: "Hello", channel_ids: ["c1"] }, { text: "b" }], draft: true });
  assert.equal(v.posts[0].text, "a", "the original is unchanged");
  assert.equal(next.posts[1], v.posts[1], "untouched parts are shared");
  assert.deepEqual(setPath({ a: 1 }, [], { b: 2 }), { b: 2 });
});

// ─────────────── decide ───────────────

const AP: Approval = {
  id: 5,
  workspace_id: "ws-1",
  thread_id: "t-1",
  agent: "social",
  product: "capybaroar",
  tool: "create_posts",
  input: { posts: [{ text: "Fresh bread today" }] },
  title: "Create posts (Social media)",
  why: "This changes your social media.",
  status: "pending",
  result: null,
  decided_by: null,
  created_at: "2026-11-18T10:00:00Z",
  decided_at: null,
  finished_at: null,
};

/** An in-memory approvals table with the same one-step claim as decide_approval(). */
function fakeDeps(o: { run?: DecideDeps["run"]; failFinish?: boolean } = {}) {
  const rows = new Map<number, Approval>([[AP.id, structuredClone(AP)]]);
  const ran: Approval[] = [];
  const notes: [string, string][] = [];
  const activity: string[] = [];
  const logs: string[] = [];
  const deps: DecideDeps = {
    load: async (id) => (rows.has(id) ? structuredClone(rows.get(id)!) : null),
    claim: async (id, by, d: Decision) => {
      const r = rows.get(id);
      if (!r || r.status !== "pending") return null;
      Object.assign(r, { status: d.action === "approve" ? "running" : "denied", decided_by: by, decided_at: "now", ...(d.action === "approve" && d.input ? { input: d.input } : {}) });
      return structuredClone(r);
    },
    run: o.run ?? (async (ap) => (ran.push(ap), { ok: true, text: "3 posts saved as drafts." })),
    finish: async (id, status, result) => {
      if (o.failFinish) throw new Error("database down");
      Object.assign(rows.get(id)!, { status, result, finished_at: "now" });
    },
    note: async (ap, text, status) => void notes.push([text, status]),
    activity: async (_ap, text) => void activity.push(text),
    log: (m) => logs.push(m),
  };
  return { deps, rows, ran, notes, activity, logs };
}

test("approve runs the change, saves the result, notes it in the chat and logs it", async () => {
  const f = fakeDeps();
  const out = await decide(5, "u1", { action: "approve", input: null }, f.deps);
  assert.deepEqual(out, { status: 200, body: { status: "done", result: "3 posts saved as drafts." } });
  assert.equal(f.ran.length, 1);
  assert.deepEqual(f.ran[0].input, AP.input);
  assert.deepEqual([f.rows.get(5)!.status, f.rows.get(5)!.result, f.rows.get(5)!.decided_by], ["done", "3 posts saved as drafts.", "u1"]);
  assert.deepEqual(f.notes, [["Approved and done: Create posts (Social media)", "done"]]);
  assert.deepEqual(f.activity, ["finished: Create posts (Social media)"]);
});

test("approve with edited details runs the edited details", async () => {
  const f = fakeDeps();
  const edited = { posts: [{ text: "Fresh sourdough today" }] };
  await decide(5, "u1", { action: "approve", input: edited }, f.deps);
  assert.deepEqual(f.ran[0].input, edited);
  assert.deepEqual(f.rows.get(5)!.input, edited);
});

test("deny never runs anything", async () => {
  const f = fakeDeps();
  assert.deepEqual(await decide(5, "u1", { action: "deny" }, f.deps), { status: 200, body: { status: "denied" } });
  assert.equal(f.ran.length, 0);
  assert.equal(f.rows.get(5)!.status, "denied");
  assert.deepEqual(f.notes, [["Not approved: Create posts (Social media)", "denied"]]);
  assert.deepEqual(f.activity, ["prepared a change that was not approved: Create posts (Social media)"]);
});

test("a second decision is refused, even two at the same moment, and the change runs once", async () => {
  const f = fakeDeps();
  const [a, b] = await Promise.all([decide(5, "u1", { action: "approve", input: null }, f.deps), decide(5, "u2", { action: "approve", input: null }, f.deps)]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.equal(f.ran.length, 1);
  const again = await decide(5, "u1", { action: "deny" }, f.deps);
  assert.deepEqual(again, { status: 409, body: { error: APPROVAL_MESSAGES.handled, status: "done" } });
  assert.deepEqual(await decide(99, "u1", { action: "deny" }, f.deps), { status: 404, body: { error: APPROVAL_MESSAGES.notFound } });
});

test("a change that fails or throws is saved as failed with what went wrong", async () => {
  const f = fakeDeps({ run: async () => ({ ok: false, text: "Channel c9 isn't in this workspace." }) });
  const out = await decide(5, "u1", { action: "approve", input: null }, f.deps);
  assert.deepEqual(out.body, { status: "failed", result: "Channel c9 isn't in this workspace." });
  assert.deepEqual(f.notes, [["Approved, but it didn't work: Create posts (Social media)", "failed"]]);
  const g = fakeDeps({
    run: async () => {
      throw new Error("boom");
    },
  });
  assert.equal((await decide(5, "u1", { action: "approve", input: null }, g.deps)).body.status, "failed");
  assert.equal(g.rows.get(5)!.result, "boom");
});

test("a result that can't be saved is logged for staff, and the person still hears how it went", async () => {
  const f = fakeDeps({ failFinish: true });
  const out = await decide(5, "u1", { action: "approve", input: null }, f.deps);
  assert.equal(out.body.status, "done");
  assert.match(f.logs.join("\n"), /ran \(done\) but its result wasn't saved: database down/);
  assert.equal(f.rows.get(5)!.status, "running", "the stale sweep marks it later");
});
