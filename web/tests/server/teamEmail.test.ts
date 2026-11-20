// The email door's routes with a fake database: POST /api/email/inbound, POST /api/email/team and the Approve link
// page (GET and POST /api/email/approve). Everything is off until TEAM_EMAIL_DOMAIN is set. Nothing reaches Resend.
// Run with: node --conditions=react-server --test tests/server/*.test.ts (part of npm test).

import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { register } from "node:module";
import { beforeEach, test } from "node:test";
import { fakeDb } from "./fakeDb.ts";
import { auth } from "./stubs/serverAuth.ts";

register("./tsResolve.mjs", import.meta.url);

const RAW = randomBytes(32).toString("base64");
process.env.SEALING_KEYS = `t1:${randomBytes(32).toString("base64")}`;
process.env.RESEND_INBOUND_SECRET = `whsec_${RAW}`;
process.env.APP_URL = "https://chat.test";
delete process.env.TEAM_EMAIL_DOMAIN;

const inbound = await import("../../src/app/api/email/inbound/route.ts");
const team = await import("../../src/app/api/email/team/route.ts");
const approve = await import("../../src/app/api/email/approve/route.ts");
const { makeApproveToken, newNonce } = await import("../../src/lib/approveLink.ts");
const { envKeyring } = await import("../../src/lib/sealing.ts");

const WS = "11111111-2222-4333-8444-555555555555";
const ANA = "aaaaaaaa-2222-4333-8444-555555555555";

let db: ReturnType<typeof fakeDb>;
let queued: unknown[];
let drops: string[];
let decided: unknown[];

beforeEach(() => {
  delete process.env.TEAM_EMAIL_DOMAIN;
  db = fakeDb();
  db.tables.team_email = [{ workspace_id: WS, slug: "acme", enabled: true }];
  db.tables.approvals = [{ id: 7, workspace_id: WS, title: "Schedule 3 posts", why: "For next week", status: "pending" }];
  db.tables.workspace_members = [{ workspace_id: WS, user_id: ANA, role: "owner" }];
  db.tables.approval_links = [];
  queued = [];
  drops = [];
  decided = [];
  db.rpcs.team_email_sender = (a) => (a.p_ws === WS && a.p_email === "ana@bakery.com" ? [{ kind: "member", user_id: ANA, role: "owner" }] : []);
  db.rpcs.queue_team_email = (a) => (queued.push(a), true);
  db.rpcs.count_team_email_drop = (a) => (drops.push(String(a.p_reason)), null);
  db.rpcs.use_approval_link = (a) => {
    const l = db.tables.approval_links.find((x) => x.nonce === a.p_nonce);
    if (!l || l.approval_id !== a.p_approval || l.user_id !== a.p_user) return "missing";
    if (l.used_at) return "used";
    l.used_at = new Date().toISOString();
    return "ok";
  };
  // Someone else decided it a moment ago: decide() answers 409, and nothing runs.
  db.rpcs.decide_approval = (a) => (decided.push(a), []);
  auth.db = db;
  auth.roles = new Map([[`${ANA}:${WS}`, "owner"]]);
});

function webhook(data: Record<string, unknown> = {}) {
  const body = JSON.stringify({ type: "email.received", data: { email_id: "e-1", from: "Ana <ana@bakery.com>", to: ["acme@team.morningtelos.com"], ...data } });
  const id = "msg_1";
  const ts = Math.floor(Date.now() / 1000);
  const sig = `v1,${createHmac("sha256", Buffer.from(RAW, "base64")).update(`${id}.${ts}.${body}`).digest("base64")}`;
  return new Request("https://chat.test/api/email/inbound", { method: "POST", headers: { "svix-id": id, "svix-timestamp": String(ts), "svix-signature": sig }, body });
}

test("off by default: the webhook answers 404, Settings hears no domain, the Approve page is 404", async () => {
  const r = await inbound.POST(webhook());
  assert.equal(r.status, 404);
  assert.deepEqual(queued, []);
  const s = await team.POST(new Request("https://chat.test/api/email/team", { method: "POST", headers: { authorization: `Bearer ${ANA}` }, body: JSON.stringify({ workspaceId: WS }) }));
  assert.deepEqual(await s.json(), { domain: null });
  const a = await approve.GET(new Request("https://chat.test/api/email/approve?a=7&t=x"));
  assert.equal(a.status, 404);
  assert.match(a.headers.get("content-type") ?? "", /text\/html/);
});

test("on: a signed email from a member is queued once; a stranger's is dropped and counted", async () => {
  process.env.TEAM_EMAIL_DOMAIN = "team.morningtelos.com";
  const r = await inbound.POST(webhook());
  assert.equal(r.status, 200);
  assert.deepEqual(queued, [{ p_email_id: "e-1", p_ws: WS }]);
  const x = await inbound.POST(webhook({ email_id: "e-2", from: "x@spam.com" }));
  assert.deepEqual(await x.json(), { ok: true, dropped: true });
  assert.deepEqual(drops, ["unknown_sender"]);
  assert.equal(queued.length, 1);
  const bad = await inbound.POST(new Request("https://chat.test/api/email/inbound", { method: "POST", body: "{}" }));
  assert.equal(bad.status, 401);
});

test("Settings: members hear the domain once it is set; strangers are refused", async () => {
  process.env.TEAM_EMAIL_DOMAIN = "team.morningtelos.com";
  const ok = await team.POST(new Request("https://chat.test/api/email/team", { method: "POST", headers: { authorization: `Bearer ${ANA}` }, body: JSON.stringify({ workspaceId: WS }) }));
  assert.deepEqual(await ok.json(), { domain: "team.morningtelos.com" });
  const no = await team.POST(new Request("https://chat.test/api/email/team", { method: "POST", headers: { authorization: "Bearer stranger" }, body: JSON.stringify({ workspaceId: WS }) }));
  assert.equal(no.status, 403);
});

test("Approve link: GET shows a button and uses nothing; POST uses the link and goes to the approvals path once", async () => {
  process.env.TEAM_EMAIL_DOMAIN = "team.morningtelos.com";
  const nonce = newNonce();
  const { token, expiresAt } = makeApproveToken(envKeyring(), { approvalId: 7, workspaceId: WS, userId: ANA, nonce, now: Date.now() });
  db.tables.approval_links.push({ nonce, approval_id: 7, workspace_id: WS, user_id: ANA, expires_at: expiresAt, used_at: null });

  const get = await approve.GET(new Request(`https://chat.test/api/email/approve?a=7&t=${encodeURIComponent(token)}`));
  assert.equal(get.status, 200);
  assert.equal(get.headers.get("x-robots-tag"), "noindex");
  const html = await get.text();
  assert.match(html, /Approve this change\?/);
  assert.match(html, /Schedule 3 posts/);
  assert.equal(db.tables.approval_links[0].used_at, null);
  assert.deepEqual(decided, []);

  const form = new FormData();
  form.set("a", "7");
  form.set("t", token);
  const post = await approve.POST(new Request("https://chat.test/api/email/approve", { method: "POST", body: form }));
  assert.equal(post.status, 200);
  assert.match(await post.text(), /already handled/);
  assert.ok(db.tables.approval_links[0].used_at);
  assert.deepEqual(decided, [{ p_id: 7, p_ws: WS, p_by: ANA, p_action: "approve", p_input: null }]);

  const again = await approve.POST(new Request("https://chat.test/api/email/approve", { method: "POST", body: form }));
  assert.match(await again.text(), /already used/);
  assert.equal(decided.length, 1);
});
