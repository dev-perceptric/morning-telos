// Leo's Posts tab (src/lib/socialWork.ts): what goes on the calendar, the person's own changes, and
// disconnecting a social account. Every dependency is a fake: no Capybaroar, no database.
import assert from "node:assert/strict";
import test from "node:test";
import type { PartnerResult } from "../src/lib/partner.ts";
import {
  approvalItems,
  cleanRange,
  disconnectSocial,
  editedApproval,
  postItems,
  SOCIAL_MESSAGES,
  socialAct,
  socialPosts,
  summaryLine,
  type Channel,
} from "../src/lib/socialWork.ts";

const allow = async () => ({ ok: true as const, userId: "u1" });
const deny = async () => ({ ok: false as const, status: 403, error: "Not allowed." });
const gateAt = (role: "viewer" | "editor" | "admin") => {
  const rank = { viewer: 1, editor: 2, admin: 3, owner: 4 };
  return async (min: "owner" | "admin" | "editor" | "viewer") => (rank[role] >= rank[min] ? allow() : deny());
};

// ─────────────── what goes on the calendar ───────────────

test("postItems: Capybaroar's statuses become calendar states, deleted posts and removed channels are left out", () => {
  const items = postItems(
    [
      { id: "p1", status: "scheduled", text: "Soon", publish_at: "2027-01-05T09:00:00Z", channels: [{ channel_id: "li" }, { channel_id: "ig", deleted_at: "2027-01-01T00:00:00Z" }] },
      { id: "p2", status: "published", text: "Out", publish_at: "2027-01-01T09:00:00Z", channels: [{ channel_id: "li", url: "https://linkedin.com/p/2" }] },
      { id: "p3", status: "failed", text: "Oops", publish_at: "2027-01-02T09:00:00Z", channels: [{ channel_id: "ig", error: "Token expired" }] },
      { id: "p4", status: "deleted", text: "Gone", publish_at: null },
      { id: "p5", status: "review", text: "Draft", publish_at: "nonsense" },
      { id: "p6", status: "weird", text: "?" },
      null,
      { status: "scheduled" },
    ],
    new Map([["p2", 31]]),
  );
  assert.deepEqual(
    items.map((i) => [i.key, i.status, i.at, i.channelIds, i.url, i.engagements, i.error]),
    [
      ["p:p1", "sched", "2027-01-05T09:00:00Z", ["li"], null, null, null],
      ["p:p2", "done", "2027-01-01T09:00:00Z", ["li"], "https://linkedin.com/p/2", 31, null],
      ["p:p3", "failed", "2027-01-02T09:00:00Z", ["ig"], null, null, "Token expired"],
      ["p:p5", "draft", null, [], null, null, null],
    ],
  );
  assert.deepEqual(postItems("not a list"), []);
});

test("approvalItems: each post Leo is waiting on, from create_posts and update_post only", () => {
  const items = approvalItems([
    { id: 7, tool: "create_posts", status: "pending", input: { posts: [{ text: "A", channel_ids: ["li"], publish_at: "2027-01-06T09:00:00Z" }, { text: "B", channel_ids: ["ig", 3] }, "bad"] } },
    { id: 8, tool: "update_post", status: "pending", input: { id: "p1", text: "New words" } },
    { id: 9, tool: "delete_post", status: "pending", input: { id: "p2" } },
    { id: 10, tool: "create_posts", status: "done", input: { posts: [{ text: "Old" }] } },
    { id: 11, tool: "update_post", status: "pending", input: { text: "no id" } },
  ]);
  assert.deepEqual(
    items.map((i) => [i.key, i.status, i.text, i.at, i.channelIds, i.approvalId, i.index, i.postId]),
    [
      ["a:7:0", "wait", "A", "2027-01-06T09:00:00Z", ["li"], 7, 0, null],
      ["a:7:1", "wait", "B", null, ["ig"], 7, 1, null],
      ["a:8:0", "wait", "New words", null, [], 8, null, "p1"],
    ],
  );
});

test("editedApproval changes only the post the person edited", () => {
  const input = { posts: [{ text: "A", channel_ids: ["li"], publish_at: "2027-01-06T09:00:00Z", mode: "schedule" }, { text: "B", channel_ids: ["ig"] }] };
  assert.deepEqual(editedApproval("create_posts", input, 1, { text: "B2", at: "2027-01-07T10:00:00Z", channelIds: ["ig", "li"] }), {
    posts: [input.posts[0], { text: "B2", channel_ids: ["ig", "li"], publish_at: "2027-01-07T10:00:00Z" }],
  });
  assert.deepEqual(input.posts[1], { text: "B", channel_ids: ["ig"] }, "the original is left alone");
  assert.deepEqual(editedApproval("update_post", { id: "p1", text: "x", publish_at: "2027-01-01T00:00:00Z" }, null, { text: "y", at: null }), { id: "p1", text: "y" });
});

test("summaryLine: one plain sentence, or nothing before the first post", () => {
  assert.equal(summaryLine(null), null);
  assert.equal(summaryLine({ current: { posts: 0, reach: 0 } }), null);
  assert.equal(summaryLine({ current: { posts: 1, reach: 1 } }), "Last 30 days: 1 post reached 1 person.");
  assert.equal(summaryLine({ current: { posts: 12, reach: 4210 }, previous: { reach: 3000 } }), "Last 30 days: 12 posts reached 4,210 people. That's 40% more than the 30 days before.");
  assert.equal(summaryLine({ current: { posts: 4, reach: 900 }, previous: { reach: 1200 } }), "Last 30 days: 4 posts reached 900 people. That's 25% less than the 30 days before.");
  assert.equal(summaryLine({ current: { posts: 4, reach: 900 }, previous: { reach: 900 } }), "Last 30 days: 4 posts reached 900 people.");
});

test("cleanRange: real dates, in order, at most 92 days", () => {
  assert.deepEqual(cleanRange("2027-01-01T00:00:00Z", "2027-01-08T00:00:00Z"), { ok: true, from: "2027-01-01T00:00:00.000Z", to: "2027-01-08T00:00:00.000Z" });
  assert.deepEqual(cleanRange("2027-01-08T00:00:00Z", "2027-01-01T00:00:00Z"), { ok: false });
  assert.deepEqual(cleanRange("2027-01-01T00:00:00Z", "2027-06-01T00:00:00Z"), { ok: false });
  assert.deepEqual(cleanRange("soon", "later"), { ok: false });
  assert.deepEqual(cleanRange(null, undefined), { ok: false });
});

// ─────────────── GET: the calendar ───────────────

const CHANNELS: Channel[] = [{ id: "li", network: "linkedin", name: "Perceptric", status: "connected" }];
const PENDING = [{ id: 7, tool: "create_posts", status: "pending", input: { posts: [{ text: "Waiting", channel_ids: ["li"], publish_at: "2027-01-06T09:00:00Z" }] } }];
const RANGE = { from: "2027-01-04T00:00:00Z", to: "2027-01-11T00:00:00Z" };

function readDeps(o: { status?: string | null; read?: (tool: string, input: Record<string, unknown>) => Promise<string | null>; gate?: typeof allow } = {}) {
  const reads: [string, Record<string, unknown>][] = [];
  return {
    reads,
    deps: {
      gate: o.gate ?? gateAt("viewer"),
      serviceStatus: async () => (o.status === undefined ? "ready" : o.status),
      read:
        o.read ??
        (async (tool: string, input: Record<string, unknown>) => {
          reads.push([tool, input]);
          if (tool === "list_posts") return JSON.stringify({ posts: [{ id: "p1", status: "published", text: "Out", publish_at: "2027-01-05T09:00:00Z", channels: [{ channel_id: "li" }] }] });
          if (tool === "get_analytics") return JSON.stringify({ analytics: { current: { posts: 3, reach: 640 }, previous: { reach: 0 }, top_posts: [{ id: "p1", engagements: 12 }] } });
          return null;
        }),
      approvals: async () => PENDING,
      channels: async () => CHANNELS,
    },
  };
}

test("socialPosts: Capybaroar's posts and the waiting ones together, with Leo's line", async () => {
  const { deps, reads } = readDeps();
  const out = await socialPosts(RANGE, deps);
  assert.equal(out.status, 200);
  assert.equal(out.body.ready, true);
  assert.equal(out.body.summary, "Last 30 days: 3 posts reached 640 people.");
  assert.deepEqual(out.body.channels, CHANNELS);
  assert.deepEqual((out.body.items as { key: string; status: string; engagements: number | null }[]).map((i) => [i.key, i.status, i.engagements]), [
    ["p:p1", "done", 12],
    ["a:7:0", "wait", null],
  ]);
  assert.deepEqual(reads, [
    ["list_posts", { from: "2027-01-04T00:00:00.000Z", to: "2027-01-11T00:00:00.000Z" }],
    ["get_analytics", { days: 30 }],
  ]);
});

test("socialPosts: before Capybaroar is ready, only the waiting posts; a failed read says so plainly", async () => {
  const setup = await socialPosts(RANGE, readDeps({ status: "provisioning" }).deps);
  assert.equal(setup.body.ready, false);
  assert.equal((setup.body.items as unknown[]).length, 1);
  const failed = await socialPosts(RANGE, readDeps({ read: async () => null }).deps);
  assert.equal(failed.status, 200);
  assert.equal(failed.body.error, SOCIAL_MESSAGES.load);
  assert.equal((failed.body.items as unknown[]).length, 1, "the waiting posts still show");
});

test("socialPosts: checks the role and the range first", async () => {
  assert.deepEqual(await socialPosts(RANGE, readDeps({ gate: deny }).deps), { status: 403, body: { error: "Not allowed." } });
  assert.deepEqual(await socialPosts({ from: "2027-01-01", to: "2027-09-01" }, readDeps().deps), { status: 400, body: { error: SOCIAL_MESSAGES.range } });
});

// ─────────────── POST: the person's own changes ───────────────

const NOW = Date.parse("2027-01-04T12:00:00Z");
function actDeps(o: { role?: "viewer" | "editor" | "admin"; write?: { ok: boolean; text: string } } = {}) {
  const writes: [string, Record<string, unknown>][] = [];
  const lines: string[] = [];
  return {
    writes,
    lines,
    deps: {
      gate: gateAt(o.role ?? "editor"),
      write: async (tool: string, input: Record<string, unknown>) => (writes.push([tool, input]), o.write ?? { ok: true, text: "{}" }),
      activity: async (t: string) => void lines.push(t),
      now: () => NOW,
    },
  };
}

test("socialAct: create, save and delete run in Capybaroar right away and are logged", async () => {
  const s = actDeps();
  const post = { text: " Hello ", at: "2027-01-05T09:00:00Z", channelIds: ["li"] };
  assert.deepEqual(await socialAct({ action: "create", ...post }, s.deps), { status: 200, body: { ok: true } });
  assert.deepEqual(await socialAct({ action: "save", postId: "p1", ...post }, s.deps), { status: 200, body: { ok: true } });
  assert.deepEqual(await socialAct({ action: "delete", postId: "p1" }, s.deps), { status: 200, body: { ok: true } });
  assert.deepEqual(s.writes, [
    ["create_posts", { posts: [{ channel_ids: ["li"], text: "Hello", publish_at: "2027-01-05T09:00:00Z", mode: "schedule" }] }],
    ["update_post", { id: "p1", text: "Hello", publish_at: "2027-01-05T09:00:00Z", channel_ids: ["li"], mode: "schedule" }],
    ["delete_post", { id: "p1" }],
  ]);
  assert.deepEqual(s.lines, ["You scheduled a post on the social calendar.", "You changed a post on the social calendar.", "You deleted a post on the social calendar."]);
});

test("socialAct: viewers can't change posts, and bad input never reaches Capybaroar", async () => {
  const viewer = actDeps({ role: "viewer" });
  assert.equal((await socialAct({ action: "delete", postId: "p1" }, viewer.deps)).status, 403);
  const s = actDeps();
  const base = { action: "create", text: "Hi", at: "2027-01-05T09:00:00Z", channelIds: ["li"] };
  const cases: [Record<string, unknown>, string][] = [
    [{ ...base, text: "  " }, SOCIAL_MESSAGES.text],
    [{ ...base, text: "x".repeat(5001) }, SOCIAL_MESSAGES.tooLong],
    [{ ...base, channelIds: [] }, SOCIAL_MESSAGES.channels],
    [{ ...base, at: "whenever" }, SOCIAL_MESSAGES.time],
    [{ ...base, at: "2027-01-01T09:00:00Z" }, SOCIAL_MESSAGES.past],
    [{ action: "save", text: "Hi", at: base.at, channelIds: ["li"] }, SOCIAL_MESSAGES.post],
    [{ action: "delete" }, SOCIAL_MESSAGES.post],
    [{ action: "publish_everything" }, SOCIAL_MESSAGES.action],
  ];
  for (const [b, error] of cases) assert.deepEqual(await socialAct(b, s.deps), { status: 400, body: { error } }, error);
  assert.equal(s.writes.length + viewer.writes.length, 0);
});

test("socialAct: Capybaroar's refusal comes back as the error, with nothing logged", async () => {
  const s = actDeps({ write: { ok: false, text: "That post already went out." } });
  assert.deepEqual(await socialAct({ action: "delete", postId: "p1" }, s.deps), { status: 502, body: { error: "That post already went out." } });
  assert.deepEqual(s.lines, []);
});

// ─────────────── disconnecting an account ───────────────

function discDeps(o: { role?: "viewer" | "editor" | "admin"; result?: PartnerResult<null>; channel?: Channel | null; brand?: string | null; partnerOff?: boolean } = {}) {
  const calls: [string, string][] = [];
  const forgot: string[] = [];
  const logs: string[] = [];
  const lines: string[] = [];
  return {
    calls,
    forgot,
    logs,
    lines,
    deps: {
      gate: gateAt(o.role ?? "admin"),
      brandId: async () => (o.brand === undefined ? "b1" : o.brand),
      partner: () =>
        o.partnerOff
          ? { ok: false as const, error: "Capybaroar partner key is not set on the server." }
          : { ok: true as const, partner: { disconnectChannel: async (b: string, c: string) => (calls.push([b, c]), o.result ?? { ok: true as const, status: 204, data: null }) } },
      channel: async (id: string) => (o.channel === undefined ? (id === "li" ? CHANNELS[0] : null) : o.channel),
      forget: async (id: string) => void forgot.push(id),
      activity: async (t: string) => void lines.push(t),
      log: (m: string) => void logs.push(m),
    },
  };
}

test("disconnectSocial: Capybaroar lets the account go, then we forget it and log it", async () => {
  const s = discDeps();
  assert.deepEqual(await disconnectSocial({ channelId: "li" }, s.deps), { status: 200, body: { ok: true } });
  assert.deepEqual(s.calls, [["b1", "li"]]);
  assert.deepEqual(s.forgot, ["li"]);
  assert.deepEqual(s.lines, ["You disconnected Perceptric."]);
});

test("disconnectSocial: a channel Capybaroar already let go counts as done; an older Capybaroar's 404 does not", async () => {
  const gone = discDeps({ result: { ok: false, status: 404, code: "not_found", message: "Channel not found", retryable: false } });
  assert.equal((await disconnectSocial({ channelId: "li" }, gone.deps)).status, 200);
  assert.deepEqual(gone.forgot, ["li"]);
  const noRoute = discDeps({ result: { ok: false, status: 404, code: "http_404", message: "Not Found", retryable: false } });
  assert.deepEqual(await disconnectSocial({ channelId: "li" }, noRoute.deps), { status: 502, body: { error: SOCIAL_MESSAGES.disconnectFailed } });
  assert.deepEqual(noRoute.forgot, [], "kept: it's still connected in Capybaroar");
  const brandGone = discDeps({ result: { ok: false, status: 404, code: "not_found", message: "Brand not found", retryable: false } });
  assert.equal((await disconnectSocial({ channelId: "li" }, brandGone.deps)).status, 502);
  const busy = discDeps({ result: { ok: false, status: 503, code: "unavailable", message: "Down", retryable: true } });
  assert.equal((await disconnectSocial({ channelId: "li" }, busy.deps)).status, 503);
  assert.equal(busy.logs.length, 1);
});

test("disconnectSocial: owners and admins only, a known channel only, and a ready brand", async () => {
  const editor = discDeps({ role: "editor" });
  assert.equal((await disconnectSocial({ channelId: "li" }, editor.deps)).status, 403);
  const s = discDeps();
  assert.deepEqual(await disconnectSocial({ channelId: "" }, s.deps), { status: 400, body: { error: SOCIAL_MESSAGES.disconnectMissing } });
  assert.deepEqual(await disconnectSocial({ channelId: "nope" }, s.deps), { status: 404, body: { error: SOCIAL_MESSAGES.disconnectMissing } });
  assert.deepEqual(await disconnectSocial({ channelId: "li" }, discDeps({ brand: null }).deps), { status: 409, body: { error: SOCIAL_MESSAGES.setup } });
  const off = discDeps({ partnerOff: true });
  assert.deepEqual(await disconnectSocial({ channelId: "li" }, off.deps), { status: 503, body: { error: SOCIAL_MESSAGES.disconnectFailed } });
  assert.equal(s.calls.length + editor.calls.length + off.calls.length, 0);
});

test("an approval's posts show as posts, with when each goes out", async () => {
  const { reviewPosts, postWhen } = await import("../src/lib/socialWork.ts");
  const input = { posts: [{ channel_ids: ["c1"], text: "Hi", publish_at: "2026-11-23T09:00:00-05:00", mode: "draft" }, { channel_ids: ["c2"], text: "Yo", mode: "now", media_ids: ["m1", "m2"] }, "junk"] };
  const posts = reviewPosts("capybaroar", "create_posts", input)!;
  assert.equal(posts.length, 2);
  assert.deepEqual(posts[0], { index: 0, text: "Hi", at: "2026-11-23T09:00:00-05:00", best: false, channelIds: ["c1"], mode: "draft", media: 0 });
  assert.equal(posts[1].media, 2);
  assert.equal(reviewPosts("capybaroar", "update_post", { id: "p1", text: "New", mode: "schedule" })![0].index, null);
  assert.equal(reviewPosts("capybaroar", "delete_post", { id: "p1" }), null);
  assert.equal(reviewPosts("arrowsterr", "create_posts", input), null);
  const f = () => "Mon, Nov 23 at 9:00 AM";
  assert.equal(postWhen(posts[0], f), "Draft for Mon, Nov 23 at 9:00 AM. It won't go out until it's scheduled.");
  assert.equal(postWhen(posts[1], f), "Goes out when you approve");
  assert.equal(postWhen({ at: "2026-11-23T14:00:00Z", best: false, mode: "schedule" }, f), "Goes out Mon, Nov 23 at 9:00 AM");
  assert.equal(postWhen({ at: null, best: true, mode: "schedule" }, f), "Goes out at your next best time");
  assert.equal(postWhen({ at: null, best: false, mode: "queue" }, f), "Goes out at the next open time slot");
});
