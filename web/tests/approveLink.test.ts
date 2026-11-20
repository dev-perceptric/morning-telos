// The Approve link in team emails (src/lib/approveLink.ts): the sealed token, its 72 hours, one use, the member it
// was sent to, and the page: opening it approves nothing, only the button does, once.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import {
  APPROVE_LINK_HOURS,
  approvePage,
  approveUrl,
  handleApproveLink,
  LINK_MESSAGES,
  linkState,
  makeApproveToken,
  newNonce,
  NONCE,
  readApproveToken,
  type ApproveLinkDeps,
  type LinkRow,
  type LinkState,
} from "../src/lib/approveLink.ts";
import { keyringFromEnv } from "../src/lib/sealing.ts";

const ring = keyringFromEnv({ SEALING_KEYS: `k1:${randomBytes(32).toString("base64")}` });
const other = keyringFromEnv({ SEALING_KEYS: `k1:${randomBytes(32).toString("base64")}` });
const WS = "11111111-2222-4333-8444-555555555555";
const ANA = "aaaaaaaa-2222-4333-8444-555555555555";
const BO = "bbbbbbbb-2222-4333-8444-555555555555";
const NOW = Date.parse("2026-11-20T12:00:00Z");
const HOUR = 3_600_000;

function link(o: { approvalId?: number; userId?: string; now?: number } = {}) {
  const nonce = newNonce();
  const made = makeApproveToken(ring, { approvalId: o.approvalId ?? 7, workspaceId: WS, userId: o.userId ?? ANA, nonce, now: o.now ?? NOW });
  const row: LinkRow = { nonce, approval_id: o.approvalId ?? 7, workspace_id: WS, user_id: o.userId ?? ANA, expires_at: made.expiresAt, used_at: null };
  return { ...made, nonce, row };
}

test("tokens: sealed for one approval and one member, 72 hours", () => {
  const l = link();
  assert.match(l.nonce, NONCE);
  assert.equal(Date.parse(l.expiresAt) - NOW, APPROVE_LINK_HOURS * HOUR);
  const r = readApproveToken(ring, 7, l.token, NOW + HOUR);
  assert.ok(r.ok);
  assert.deepEqual(r.claims, { a: 7, w: WS, u: ANA, n: l.nonce, e: NOW + 72 * HOUR });
  assert.doesNotMatch(l.token, new RegExp(ANA), "the member's id isn't readable in the link");
});

test("tokens: expired after 72 hours, and useless for another approval, with another key or when changed", () => {
  const l = link();
  assert.deepEqual(readApproveToken(ring, 7, l.token, NOW + 72 * HOUR), { ok: false, reason: "expired" });
  assert.deepEqual(readApproveToken(ring, 8, l.token, NOW), { ok: false, reason: "bad" }, "the approval id is bound in");
  assert.deepEqual(readApproveToken(other, 7, l.token, NOW), { ok: false, reason: "bad" });
  const parts = l.token.split(".");
  parts[4] = Buffer.from("x".repeat(40)).toString("base64");
  assert.deepEqual(readApproveToken(ring, 7, parts.join("."), NOW), { ok: false, reason: "bad" });
  for (const t of ["", "nope", null, 5, "x".repeat(3000)]) assert.deepEqual(readApproveToken(ring, 7, t, NOW), { ok: false, reason: "bad" });
  assert.deepEqual(readApproveToken(ring, null, l.token, NOW), { ok: false, reason: "bad" });
});

test("linkState: once, before it expires, and only for the member, approval and workspace it was made for", () => {
  const l = link();
  const c = readApproveToken(ring, 7, l.token, NOW);
  assert.ok(c.ok);
  assert.equal(linkState(l.row, c.claims, NOW), "ok");
  assert.equal(linkState({ ...l.row, used_at: "2026-11-20T12:01:00Z" }, c.claims, NOW), "used");
  assert.equal(linkState(l.row, c.claims, NOW + 72 * HOUR), "expired");
  assert.equal(linkState(null, c.claims, NOW), "missing");
  assert.equal(linkState({ ...l.row, user_id: BO }, c.claims, NOW), "missing", "wrong member");
  assert.equal(linkState({ ...l.row, approval_id: 8 }, c.claims, NOW), "missing");
  assert.equal(linkState({ ...l.row, workspace_id: "11111111-2222-4333-8444-666666666666" }, c.claims, NOW), "missing");
  assert.equal(linkState({ ...l.row, nonce: newNonce() }, c.claims, NOW), "missing");
});

test("approveUrl and the confirm page: a form that posts, everything escaped", () => {
  assert.equal(approveUrl("https://chat.test/", 7, "v2.k1.a+b/c=.x"), "https://chat.test/api/email/approve?a=7&t=v2.k1.a%2Bb%2Fc%3D.x");
  const html = approvePage({ kind: "confirm", title: "Post <script>x</script>", why: 'Because "now"', approvalId: 7, token: 'v2."><b>', openUrl: "https://chat.test/approvals/7" });
  assert.match(html, /<form method="post" action="\/api\/email\/approve">/);
  assert.match(html, /<input type="hidden" name="a" value="7">/);
  assert.match(html, /value="v2.&quot;&gt;&lt;b&gt;"/);
  assert.match(html, /Post &lt;script&gt;x&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>x/);
  assert.match(html, /Nothing happens until you press Approve\./);
  assert.match(html, /<meta name="robots" content="noindex">/);
  for (const v of Object.values(LINK_MESSAGES)) assert.doesNotMatch(v, /[–—]/);
});

function fakeDeps(o: { rows: LinkRow[]; status?: string; role?: Record<string, boolean>; on?: boolean; decide?: { status: number; body: { status?: string } } }) {
  const calls = { decided: [] as { ws: string; id: number; user: string }[], used: [] as string[] };
  const d: ApproveLinkDeps = {
    on: o.on ?? true,
    ring: () => ring,
    now: NOW,
    appUrl: "https://chat.test",
    link: async (nonce) => o.rows.find((r) => r.nonce === nonce) ?? null,
    approval: async (ws, id) => (ws === WS && id === 7 ? { id: 7, title: "Schedule 3 posts", why: "For next week", status: o.status ?? "pending" } : null),
    canApprove: async (_ws, user) => o.role?.[user] ?? true,
    // Same as use_approval_link() in SQL.
    use: async (nonce, id, user): Promise<LinkState> => {
      const r = o.rows.find((x) => x.nonce === nonce);
      if (!r || r.approval_id !== id || r.user_id !== user) return "missing";
      if (r.used_at) return "used";
      if (Date.parse(r.expires_at) <= NOW) return "expired";
      r.used_at = new Date(NOW).toISOString();
      calls.used.push(nonce);
      return "ok";
    },
    decide: async (ws, id, user) => {
      calls.decided.push({ ws, id, user });
      return o.decide ?? { status: 200, body: { status: "done" } };
    },
  };
  return { d, calls };
}

test("GET shows the change and a button and approves nothing, even opened many times (mail scanners)", async () => {
  const l = link();
  const { d, calls } = fakeDeps({ rows: [l.row] });
  for (let i = 0; i < 3; i++) {
    const r = await handleApproveLink("GET", { a: "7", t: l.token }, d);
    assert.equal(r.status, 200);
    assert.match(r.html, /Approve this change\?/);
    assert.match(r.html, /Schedule 3 posts/);
    assert.match(r.html, /<button type="submit">Approve<\/button>/);
  }
  assert.deepEqual(calls.decided, []);
  assert.deepEqual(calls.used, []);
  assert.equal(l.row.used_at, null);
});

test("POST approves once, as the member the email went to; a second press is refused", async () => {
  const l = link();
  const { d, calls } = fakeDeps({ rows: [l.row] });
  const first = await handleApproveLink("POST", { a: "7", t: l.token }, d);
  assert.equal(first.status, 200);
  assert.match(first.html, /Approved and done\./);
  assert.deepEqual(calls.decided, [{ ws: WS, id: 7, user: ANA }]);
  const again = await handleApproveLink("POST", { a: "7", t: l.token }, d);
  assert.match(again.html, new RegExp(LINK_MESSAGES.used.replace(/\./g, "\\.")));
  assert.equal(calls.decided.length, 1);
  const open = await handleApproveLink("GET", { a: "7", t: l.token }, d);
  assert.doesNotMatch(open.html, /<form/);
});

test("expired, wrong member, tampered, already handled, no longer an editor, and turned off", async () => {
  const old = link({ now: NOW - 73 * HOUR });
  let { d, calls } = fakeDeps({ rows: [old.row] });
  assert.match((await handleApproveLink("POST", { a: "7", t: old.token }, d)).html, /This link has expired/);

  // A token made for Bo can't use Ana's row, and Ana's token can't be pointed at another approval.
  const ana = link();
  const bo = link({ userId: BO });
  ({ d, calls } = fakeDeps({ rows: [ana.row, { ...bo.row, nonce: ana.nonce }] }));
  assert.match((await handleApproveLink("POST", { a: "7", t: bo.token }, d)).html, /This link doesn&#39;t work/);
  assert.match((await handleApproveLink("POST", { a: "8", t: ana.token }, d)).html, /This link doesn&#39;t work/);
  assert.match((await handleApproveLink("POST", { a: "7x", t: ana.token }, d)).html, /This link doesn&#39;t work/);
  assert.deepEqual(calls.decided, []);

  const l = link();
  ({ d, calls } = fakeDeps({ rows: [l.row], status: "done" }));
  assert.match((await handleApproveLink("GET", { a: "7", t: l.token }, d)).html, /already handled/);
  ({ d, calls } = fakeDeps({ rows: [l.row], role: { [ANA]: false } }));
  assert.match((await handleApproveLink("POST", { a: "7", t: l.token }, d)).html, /You can&#39;t approve this one/);
  assert.equal(l.row.used_at, null, "a refused member doesn't use up the link");
  assert.deepEqual(calls.decided, []);

  ({ d } = fakeDeps({ rows: [l.row], on: false }));
  const off = await handleApproveLink("GET", { a: "7", t: l.token }, d);
  assert.equal(off.status, 404);
});

test("POST says how it went: failed, someone else got there first", async () => {
  let l = link();
  let { d } = fakeDeps({ rows: [l.row], decide: { status: 200, body: { status: "failed" } } });
  assert.match((await handleApproveLink("POST", { a: "7", t: l.token }, d)).html, /Approved, but it didn&#39;t work/);
  l = link();
  ({ d } = fakeDeps({ rows: [l.row], decide: { status: 409, body: {} } }));
  assert.match((await handleApproveLink("POST", { a: "7", t: l.token }, d)).html, /already handled/);
});
