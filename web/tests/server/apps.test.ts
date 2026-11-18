// Settings, Apps end to end: POST /api/apps/list, /connect and /disconnect, the way back from Composio
// (GET /api/apps/composio), an approved app change through POST /api/approvals/:id, and deleting a workspace, with a
// fake database and a fake Composio behind globalThis.fetch (any other address fails the test).
// Run with: node --conditions=react-server --test tests/server/*.test.ts (part of npm test).

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { register } from "node:module";
import { beforeEach, test } from "node:test";
import { BASE, fakeComposio, KEY } from "../fakeComposio.ts";
import { fakeDb } from "./fakeDb.ts";
import { auth } from "./stubs/serverAuth.ts";

register("./tsResolve.mjs", import.meta.url);

// Fake settings, only for this test process.
process.env.SEALING_KEYS = `t1:${randomBytes(32).toString("base64")}`;
process.env.COMPOSIO_API_KEY = KEY;
process.env.COMPOSIO_BASE_URL = BASE;

let composio = fakeComposio();
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => composio.fetch(input, init)) as typeof fetch;

const apps = await import("../../src/app/api/apps/[action]/route.ts");
const back = await import("../../src/app/api/apps/composio/route.ts");
const approvals = await import("../../src/app/api/approvals/[id]/route.ts");
const del = await import("../../src/app/api/workspace/delete/route.ts");
const { APP_ACCESS } = await import("../../src/lib/composio/catalog.ts");
const { forgetConfigs, signState } = await import("../../src/lib/composio/connect.ts");
const { forgetTools } = await import("../../src/lib/composio/actions.ts");
const { envKeyring } = await import("../../src/lib/sealing.ts");

const WS = "11111111-2222-4333-8444-555555555555";
const OTHER = "11111111-2222-4333-8444-666666666666";
const ME = `mt_${WS}`;
let db: ReturnType<typeof fakeDb>;

beforeEach(() => {
  composio = fakeComposio();
  forgetConfigs();
  forgetTools();
  process.env.COMPOSIO_API_KEY = KEY;
  delete process.env.COMPOSIO_AUTH_CONFIG_PIPEDRIVE;
  db = fakeDb({ app_connections: ["workspace_id", "toolkit"] }, { autoId: ["app_connections", "messages", "activity"] });
  db.tables.workspaces = [{ id: WS, name: "Ana's Bakery" }, { id: OTHER, name: "Other Co" }];
  db.tables.workspace_members = [
    { workspace_id: WS, user_id: "owner1", role: "owner" },
    { workspace_id: WS, user_id: "admin1", role: "admin" },
    { workspace_id: WS, user_id: "editor1", role: "editor" },
    { workspace_id: WS, user_id: "viewer1", role: "viewer" },
    { workspace_id: OTHER, user_id: "owner2", role: "owner" },
  ];
  db.tables.app_connections = [];
  auth.db = db;
  auth.roles = new Map([
    [`owner1:${WS}`, "owner"],
    [`admin1:${WS}`, "admin"],
    [`editor1:${WS}`, "editor"],
    [`viewer1:${WS}`, "viewer"],
    [`owner2:${OTHER}`, "owner"],
  ]);
});

const post = (action: string, user: string | null, body: Record<string, unknown>) =>
  apps.POST(new Request(`https://app.test/api/apps/${action}`, { method: "POST", headers: user ? { Authorization: `Bearer ${user}` } : {}, body: JSON.stringify(body) }), { params: Promise.resolve({ action }) });
const comeBack = (q: Record<string, string>) => back.GET(new Request(`https://app.test/api/apps/composio?${new URLSearchParams(q)}`));
const where = (res: Response) => {
  const u = new URL(res.headers.get("location")!);
  return { path: u.pathname, ...Object.fromEntries(u.searchParams) };
};
const conn = (o: Record<string, unknown>) => ({ id: `c${db.tables.app_connections.length + 1}`, workspace_id: WS, toolkit: "gmail", composio_account: "ca_x", status: "active", account_label: null, last_error: null, connected_by: "owner1", created_at: new Date().toISOString(), ...o });

// ─────────────── list ───────────────

test("list: every member sees which apps connect and their own workspace's connections, without the Composio account", async () => {
  db.tables.app_connections.push(conn({ id: "c1", account_label: "ana@ana.test" }), conn({ id: "c9", workspace_id: OTHER, toolkit: "slack" }));
  const res = await post("list", "viewer1", { workspaceId: WS });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.on, true);
  assert.ok(body.connectable.includes("gmail"));
  assert.ok(!body.connectable.includes("pipedrive"), "Pipedrive needs our own auth config first");
  assert.equal(body.connections.length, 1);
  assert.deepEqual(Object.keys(body.connections[0]).sort(), ["created_at", "id", "label", "status", "toolkit"]);
  assert.equal(body.connections[0].label, "ana@ana.test");
  assert.equal((await post("list", "owner2", { workspaceId: WS })).status, 403);
  assert.equal((await post("list", null, { workspaceId: WS })).status, 401);
  assert.equal((await post("nope", "owner1", { workspaceId: WS })).status, 404);
});

test("without COMPOSIO_API_KEY: the list says apps are off, nothing connects, and the team gets no app tools", async () => {
  delete process.env.COMPOSIO_API_KEY;
  const body = await (await post("list", "owner1", { workspaceId: WS })).json();
  assert.deepEqual([body.on, body.connectable], [false, []]);
  const c = await post("connect", "owner1", { workspaceId: WS, toolkit: "gmail" });
  assert.equal(c.status, 400);
  assert.equal((await c.json()).error, "Apps aren't set up on the server yet.");
  const { teamTools } = await import("../../src/lib/teamTools.ts");
  db.tables.app_connections.push(conn({}));
  db.tables.services = [];
  db.rpcs.search_knowledge = () => [];
  const set = await teamTools(db as never)({ workspace: { id: WS, name: "Ana's Bakery", website: null, plan: "trial", status: "trialing", trial_ends_at: new Date(Date.now() + 864e6).toISOString(), period_start: new Date().toISOString() }, agent: "chief", threadId: "t", trust: 0, emit: () => {} });
  assert.ok(!set.tools.some((t) => t.definition.name.startsWith("app_")));
  assert.equal(composio.calls.length, 0);
});

// ─────────────── connect and the way back ───────────────

test("connect: owners and admins get Composio's page for the workspace's own Composio user; editors and viewers can't", async () => {
  for (const u of ["editor1", "viewer1", "owner2"]) {
    const r = await post("connect", u, { workspaceId: WS, toolkit: "gmail" });
    assert.equal(r.status, 403, u);
    assert.equal((await r.json()).error, "Only owners and admins can connect and disconnect apps.");
  }
  assert.equal(composio.calls.length, 0);
  const res = await post("connect", "admin1", { workspaceId: WS, toolkit: "gmail" });
  assert.equal(res.status, 200);
  assert.match((await res.json()).url, /^https:\/\/connect\.composio\.test\/link\//);
  const link = composio.calls.find((c) => c.path === "/api/v3.1/connected_accounts/link")!;
  assert.equal(link.body!.user_id, ME);
  const cb = new URL(String(link.body!.callback_url));
  assert.equal(cb.origin + cb.pathname, "https://app.test/api/apps/composio");
  assert.ok(cb.searchParams.get("state"));
  assert.equal((await post("connect", "admin1", { workspaceId: WS, toolkit: "linkedin" })).status, 400);
  const pd = await post("connect", "admin1", { workspaceId: WS, toolkit: "pipedrive" });
  assert.equal((await pd.json()).error, "Pipedrive isn't set up on the server yet.");
  assert.deepEqual(db.tables.app_connections, [], "nothing is saved before the way back");
});

test("the way back saves the workspace's own ACTIVE account with its label, for the person who started", async () => {
  const id = composio.addAccount(ME, "gmail");
  const state = signState(envKeyring(), { ws: WS, user: "admin1", toolkit: "gmail" });
  const res = await comeBack({ state, status: "success", connected_account_id: id });
  assert.equal(res.status, 302);
  assert.deepEqual(where(res), { path: "/settings/apps", app: "connected", toolkit: "gmail" });
  assert.deepEqual(
    db.tables.app_connections.map((r) => [r.workspace_id, r.toolkit, r.composio_account, r.status, r.account_label, r.connected_by]),
    [[WS, "gmail", id, "active", "ana@anasbakery.com", "admin1"]],
  );
  // Connecting again replaces the old account, and the old one is removed at Composio.
  const again = composio.addAccount(ME, "gmail");
  assert.equal(where(await comeBack({ state, status: "success", connected_account_id: again })).app, "connected");
  assert.deepEqual(db.tables.app_connections.map((r) => r.composio_account), [again]);
  assert.deepEqual(composio.deleted, [id]);
});

test("the way back refuses another workspace's account, a changed or expired note, a refusal, and someone no longer an admin", async () => {
  const theirs = composio.addAccount(`mt_${OTHER}`, "gmail");
  const ring = envKeyring();
  const state = signState(ring, { ws: WS, user: "admin1", toolkit: "gmail" });
  // Another workspace's real, ACTIVE account named in the address.
  const r1 = await comeBack({ state, status: "success", connected_account_id: theirs });
  assert.deepEqual(where(r1), { path: "/settings/apps", app: "error", reason: "We couldn't connect that app. Try again." });
  assert.deepEqual(composio.deleted, [], "another workspace's account is never removed");
  // A note sealed for the other workspace can't be used for this one, and a forged note doesn't open.
  const mine = composio.addAccount(ME, "gmail");
  const forOther = signState(ring, { ws: OTHER, user: "owner2", toolkit: "gmail" });
  assert.equal(where(await comeBack({ state: forOther, status: "success", connected_account_id: mine })).app, "error");
  assert.equal(where(await comeBack({ state: `${state.slice(0, -3)}abc`, status: "success", connected_account_id: mine })).reason, "The sign-in link ran out. Try again.");
  assert.equal(where(await comeBack({ state: signState(ring, { ws: WS, user: "admin1", toolkit: "gmail" }, Date.now() - 31 * 60_000), connected_account_id: mine })).reason, "The sign-in link ran out. Try again.");
  assert.equal(where(await comeBack({ state, status: "failed" })).reason, "Gmail wasn't connected. You can try again any time.");
  // The note was for gmail: a HubSpot account of this workspace doesn't count.
  const hub = composio.addAccount(ME, "hubspot");
  assert.equal(where(await comeBack({ state, status: "success", connected_account_id: hub })).app, "error");
  // The person who started was made an editor since.
  db.tables.workspace_members.find((m) => m.user_id === "admin1")!.role = "editor";
  assert.equal(where(await comeBack({ state, status: "success", connected_account_id: mine })).reason, "Only owners and admins can connect and disconnect apps.");
  assert.deepEqual(db.tables.app_connections, []);
});

// ─────────────── disconnect ───────────────

test("disconnect: admins remove it here and at Composio; editors can't; another workspace's connection is never touched", async () => {
  const C1 = "33333333-2222-4333-8444-000000000001";
  const C2 = "33333333-2222-4333-8444-000000000002";
  const mine = composio.addAccount(ME, "gmail");
  const theirs = composio.addAccount(`mt_${OTHER}`, "gmail");
  db.tables.app_connections.push(conn({ id: C1, composio_account: mine }), conn({ id: C2, workspace_id: OTHER, composio_account: theirs }));
  assert.equal((await post("disconnect", "editor1", { workspaceId: WS, id: C1 })).status, 403);
  assert.equal((await post("disconnect", "owner1", { workspaceId: WS, id: C2 })).status, 404);
  assert.equal((await post("disconnect", "owner1", { workspaceId: WS, id: "not-an-id" })).status, 404);
  const res = await post("disconnect", "owner1", { workspaceId: WS, id: C1 });
  assert.deepEqual([res.status, await res.json()], [200, { ok: true }]);
  assert.deepEqual(db.tables.app_connections.map((r) => r.id), [C2]);
  assert.deepEqual(composio.deleted, [mine]);
  assert.equal((await post("disconnect", "owner1", { workspaceId: WS, id: C1 })).status, 404);
});

// ─────────────── an approved app change ───────────────

test("approving an app change runs it on the workspace's account after checking again; a disconnected app is refused", async () => {
  const pending = (id: number) => ({ id, workspace_id: WS, thread_id: null, agent: "social", product: "gmail", tool: "GMAIL_SEND_EMAIL", input: { recipient_email: "bob@x.com", body: "Hi" }, title: "Send email (Gmail)", why: "x", status: "pending", decided_at: null });
  db.tables.approvals = [pending(1), pending(2)];
  db.tables.activity = [];
  db.rpcs.decide_approval = (a) => {
    const row = db.tables.approvals.find((x) => x.id === a.p_id && x.workspace_id === a.p_ws && x.status === "pending");
    if (!row) return [];
    Object.assign(row, { status: "running", decided_by: a.p_by });
    return [{ ...row }];
  };
  db.rpcs.finish_approval = (a) => Object.assign(db.tables.approvals.find((x) => x.id === a.p_id)!, { status: a.p_status, result: a.p_result }) && true;
  const decide = (id: number) => approvals.POST(new Request(`https://app.test/api/approvals/${id}`, { method: "POST", headers: { Authorization: "Bearer editor1" }, body: JSON.stringify({ workspaceId: WS, action: "approve" }) }), { params: Promise.resolve({ id: String(id) }) });
  const account = composio.addAccount(ME, "gmail");
  db.tables.app_connections.push(conn({ composio_account: account }));
  // Today no teammate may change apps, so the re-check refuses it and nothing is sent.
  assert.deepEqual(await (await decide(1)).json(), { status: "failed", result: "This teammate can't make this change any more." });
  assert.equal(composio.ran.length, 0);
  // As P4.2 will: a teammate allowed to change Gmail.
  APP_ACCESS.social = { toolkits: ["gmail"] };
  try {
    db.tables.app_connections = [];
    assert.deepEqual(await (await decide(2)).json(), { status: "failed", result: "Gmail isn't connected any more. Connect it in Settings, Apps, then ask again." });
    db.tables.approvals.push(pending(3));
    db.tables.app_connections.push(conn({ composio_account: account }));
    const ok = await (await decide(3)).json();
    assert.equal(ok.status, "done");
    assert.deepEqual(composio.ran, [{ slug: "GMAIL_SEND_EMAIL", account, user: ME, args: { recipient_email: "bob@x.com", body: "Hi" } }]);
  } finally {
    delete APP_ACCESS.social;
  }
});

// ─────────────── deleting the workspace ───────────────

test("deleting a workspace removes its apps at Composio first, and never another workspace's", async () => {
  const a = composio.addAccount(ME, "gmail");
  const b = composio.addAccount(ME, "hubspot");
  const keep = composio.addAccount(`mt_${OTHER}`, "gmail");
  db.tables.app_connections.push(conn({ id: "c1", composio_account: a }), conn({ id: "c2", toolkit: "hubspot", composio_account: b }), conn({ id: "c3", workspace_id: OTHER, composio_account: keep }));
  db.tables.services = [];
  db.tables.jobs = [];
  const res = await del.POST(new Request("https://app.test/api/workspace/delete", { method: "POST", headers: { Authorization: "Bearer owner1" }, body: JSON.stringify({ workspaceId: WS, confirm: "Ana's Bakery" }) }));
  assert.equal(res.status, 200);
  assert.deepEqual(composio.deleted.sort(), [a, b].sort());
  assert.deepEqual(db.tables.app_connections.map((r) => r.id), ["c3"]);
  assert.deepEqual(db.tables.workspaces.map((w) => w.id), [OTHER]);
});
