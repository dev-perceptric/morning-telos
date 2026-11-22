// Settings, Apps for a self-hosted WordPress site, end to end: POST /api/apps/wordpress (connect, disconnect), the
// way back from WordPress (GET /api/apps/wordpress/callback), POST /api/apps/list, an approved WordPress change
// through POST /api/approvals/:id, and Archon's tools from teamTools. A fake database, a fake WordPress behind the
// stubbed network (stubs/wordpressNet.ts), and globalThis.fetch that fails on any address.
// Run with: node --conditions=react-server --test tests/server/*.test.ts (part of npm test).

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { register } from "node:module";
import { beforeEach, test } from "node:test";
import { API, fakeWordpress, LOGIN, PASSWORD, SITE } from "../fakeWordpress.ts";
import { fakeDb } from "./fakeDb.ts";
import { auth } from "./stubs/serverAuth.ts";
import { wpStub } from "./stubs/wordpressNet.ts";

register("./tsResolve.mjs", import.meta.url);

process.env.SEALING_KEYS = `t1:${randomBytes(32).toString("base64")}`;
delete process.env.COMPOSIO_API_KEY;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  throw new Error(`Test tried to reach ${String(input)}`);
}) as typeof fetch;

const route = await import("../../src/app/api/apps/wordpress/route.ts");
const callback = await import("../../src/app/api/apps/wordpress/callback/route.ts");
const apps = await import("../../src/app/api/apps/[action]/route.ts");
const approvals = await import("../../src/app/api/approvals/[id]/route.ts");
const { teamTools } = await import("../../src/lib/teamTools.ts");
const { open } = await import("../../src/lib/sealing.ts");

const WS = "11111111-2222-4333-8444-555555555555";
const OTHER = "11111111-2222-4333-8444-666666666666";
let db: ReturnType<typeof fakeDb>;
let wp: ReturnType<typeof fakeWordpress>;

beforeEach(() => {
  wp = fakeWordpress();
  wpStub.fetch = wp.fetch;
  db = fakeDb({}, { autoId: ["messages", "activity", "approvals"] });
  db.tables.workspaces = [{ id: WS, name: "Ana's Bakery" }, { id: OTHER, name: "Other Co" }];
  db.tables.workspace_members = [
    { workspace_id: WS, user_id: "owner1", role: "owner" },
    { workspace_id: WS, user_id: "admin1", role: "admin" },
    { workspace_id: WS, user_id: "editor1", role: "editor" },
    { workspace_id: OTHER, user_id: "owner2", role: "owner" },
  ];
  db.tables.app_connections = [];
  db.tables.wordpress_sites = [];
  db.tables.wordpress_logins = [];
  // save_wordpress, as 020_wordpress.sql does it: both tables, one row per workspace.
  db.rpcs.save_wordpress = (a) => {
    db.tables.wordpress_sites = db.tables.wordpress_sites.filter((r) => r.workspace_id !== a.p_ws);
    db.tables.wordpress_logins = db.tables.wordpress_logins.filter((r) => r.workspace_id !== a.p_ws);
    db.tables.wordpress_sites.push({ workspace_id: a.p_ws, site_url: a.p_site, user_login: a.p_login, status: "active", connected_by: a.p_by, created_at: new Date().toISOString() });
    db.tables.wordpress_logins.push({ workspace_id: a.p_ws, api_root: a.p_api, sealed_password: a.p_sealed, last_error: null });
    return null;
  };
  auth.db = db;
  auth.roles = new Map([
    [`owner1:${WS}`, "owner"],
    [`admin1:${WS}`, "admin"],
    [`editor1:${WS}`, "editor"],
    [`owner2:${OTHER}`, "owner"],
  ]);
});

const post = (user: string | null, body: Record<string, unknown>) => route.POST(new Request("https://app.test/api/apps/wordpress", { method: "POST", headers: user ? { Authorization: `Bearer ${user}` } : {}, body: JSON.stringify(body) }));
const comeBack = (url: string) => callback.GET(new Request(url));
const where = (res: Response) => {
  const u = new URL(res.headers.get("location")!);
  return { path: u.pathname, ...Object.fromEntries(u.searchParams) };
};
/** Plays WordPress's Approve screen: the owner says yes, and WordPress adds the new password to success_url. */
async function approveOn(link: string, o: { site?: string; password?: string } = {}) {
  const success = new URL(new URL(link).searchParams.get("success_url")!);
  success.searchParams.set("site_url", o.site ?? SITE);
  success.searchParams.set("user_login", LOGIN);
  success.searchParams.set("password", o.password ?? PASSWORD);
  return comeBack(success.toString());
}
const connect = async (user = "owner1", site = "ana.example") => {
  const res = await post(user, { workspaceId: WS, action: "connect", site });
  return { res, body: await res.json() };
};

test("connect: owners and admins get WordPress's own Approve screen; editors, strangers and signed-out people can't", async () => {
  for (const u of ["editor1", "owner2"]) {
    const { res, body } = await connect(u);
    assert.equal(res.status, 403, u);
    assert.equal(body.error, "Only owners and admins can connect and disconnect apps.");
  }
  assert.equal((await post(null, { workspaceId: WS, action: "connect", site: "ana.example" })).status, 401);
  assert.equal(wp.calls.length, 0);
  const { res, body } = await connect("admin1");
  assert.equal(res.status, 200);
  const u = new URL(body.url);
  assert.equal(u.origin + u.pathname, `${SITE}/wp-admin/authorize-application.php`);
  assert.equal(u.searchParams.get("app_name"), "Morning Telos");
  assert.equal(new URL(u.searchParams.get("success_url")!).pathname, "/api/apps/wordpress/callback");
  assert.deepEqual(db.tables.wordpress_sites, [], "nothing is saved before the way back");
  assert.equal((await post("owner1", { workspaceId: WS, action: "nope" })).status, 404);
});

test("connect: an http site, a private address and a site with Application Passwords off are refused in one line", async () => {
  assert.deepEqual([(await connect("owner1", "http://ana.example")).res.status, (await connect("owner1", "http://ana.example")).body.error], [400, "Your site must use https. Turn it on first, or ask your web host."]);
  assert.equal((await connect("owner1", "https://192.168.1.10")).body.error, "That address points to a private network.");
  wp = fakeWordpress({ appPasswords: false });
  wpStub.fetch = wp.fetch;
  assert.equal((await connect()).body.error, "Your site has Application Passwords turned off. Turn them on, or ask your web host.");
});

test("the way back saves the sealed password after one read, and members then see the site in the list without it", async () => {
  const { body } = await connect();
  const res = await approveOn(body.url);
  assert.equal(res.status, 302);
  assert.deepEqual(where(res), { path: "/settings/apps", app: "connected", toolkit: "wordpress" });
  assert.equal(res.headers.get("referrer-policy"), "no-referrer");
  assert.deepEqual(db.tables.wordpress_sites.map((r) => [r.workspace_id, r.site_url, r.user_login, r.status, r.connected_by]), [[WS, SITE, LOGIN, "active", "owner1"]]);
  const login = db.tables.wordpress_logins[0];
  assert.equal(login.api_root, API);
  assert.doesNotMatch(String(login.sealed_password), /abcd/);
  assert.equal(open(String(login.sealed_password), `${WS}:wordpress`), PASSWORD);
  assert.deepEqual(wp.calls.filter((c) => c.headers.authorization).map((c) => c.path), ["/wp-json/wp/v2/users/me"]);
  const list = await (await apps.POST(new Request("https://app.test/api/apps/list", { method: "POST", headers: { Authorization: "Bearer editor1" }, body: JSON.stringify({ workspaceId: WS }) }), { params: Promise.resolve({ action: "list" }) })).json();
  assert.deepEqual({ ...list.wordpress, created_at: "" }, { site: SITE, login: LOGIN, status: "active", created_at: "" });
  assert.doesNotMatch(JSON.stringify(list), /sealed|v2\.t1|abcd/);
});

test("the way back refuses another site, a wrong password, an owner who said no, an expired or forged note, and someone no longer an admin", async () => {
  const { body } = await connect("admin1");
  assert.deepEqual(where(await approveOn(body.url, { site: "https://evil.example" })), { path: "/settings/apps", app: "error", reason: "WordPress sent back a different site than the one you typed. Try again." });
  assert.equal(where(await approveOn(body.url, { password: "guess" })).reason, "WordPress didn't accept the new login. Try again.");
  const reject = new URL(new URL(body.url).searchParams.get("reject_url")!);
  reject.searchParams.set("success", "false");
  assert.equal(where(await comeBack(reject.toString())).reason, "WordPress wasn't connected. You can try again any time.");
  assert.equal(where(await comeBack(`https://app.test/api/apps/wordpress/callback?state=forged&site_url=${SITE}&user_login=a&password=b`)).reason, "The connect link ran out. Try again.");
  db.tables.workspace_members.find((m) => m.user_id === "admin1")!.role = "editor";
  assert.equal(where(await approveOn(body.url)).reason, "Only owners and admins can connect and disconnect apps.");
  assert.deepEqual(db.tables.wordpress_sites, []);
  assert.deepEqual(db.tables.wordpress_logins, []);
});

test("disconnect: admins remove the site and its login, and are told they can also revoke it in WordPress; editors can't", async () => {
  await approveOn((await connect()).body.url);
  db.tables.wordpress_sites.push({ workspace_id: OTHER, site_url: "https://other.example", user_login: "bo", status: "active" });
  assert.equal((await post("editor1", { workspaceId: WS, action: "disconnect" })).status, 403);
  const res = await post("admin1", { workspaceId: WS, action: "disconnect" });
  assert.deepEqual([res.status, await res.json()], [200, { ok: true, note: "WordPress is disconnected. You can also remove Morning Telos in WordPress, under Users, Profile, Application Passwords." }]);
  assert.deepEqual(db.tables.wordpress_sites.map((r) => r.workspace_id), [OTHER], "another workspace's site is never touched");
  const again = await post("admin1", { workspaceId: WS, action: "disconnect" });
  assert.deepEqual([again.status, (await again.json()).error], [404, "WordPress is already disconnected."]);
});

test("Archon gets the WordPress tools from teamTools; an approved draft runs on the site after checking again; a revoked login is marked broken", async () => {
  await approveOn((await connect()).body.url);
  db.tables.services = [];
  db.tables.approvals = [];
  db.tables.activity = [];
  db.rpcs.search_knowledge = () => [];
  const ws = { id: WS, name: "Ana's Bakery", website: null, plan: "trial" as const, status: "trialing" as const, trial_ends_at: new Date(Date.now() + 864e6).toISOString(), period_start: new Date().toISOString() };
  const set = await teamTools(db as never)({ workspace: ws, agent: "web", threadId: "t", trust: 0, emit: () => {} });
  const names = set.tools.map((t) => t.definition.name);
  assert.ok(names.includes("wordpress_add_draft_page") && names.includes("wordpress_publish"), names.join(", "));
  // Composio is off here, but WordPress counts: he isn't told to connect a site builder.
  assert.ok(!set.missing.some((m) => /^Website/.test(m)), set.missing.join("; "));
  const other = await teamTools(db as never)({ workspace: ws, agent: "social", threadId: "t", trust: 0, emit: () => {} });
  assert.ok(!other.tools.some((t) => t.definition.name.startsWith("wordpress_")));

  const add = set.tools.find((t) => t.definition.name === "wordpress_add_draft_page")!;
  const saved = await add.run({ title: "Roof repair", content: "<p>Fix it</p>", status: "publish" }, { workspace: ws, agent: "web", threadId: "t", trust: 0, emit: () => {} });
  assert.ok(saved.approval);
  const ap = db.tables.approvals[0];
  assert.deepEqual([ap.product, ap.tool, ap.title, ap.input], ["wordpress", "wordpress_add_draft_page", "Add a draft page to WordPress", { title: "Roof repair", content: "<p>Fix it</p>" }]);
  assert.equal(wp.writes().length, 0);

  Object.assign(ap, { thread_id: null, status: "pending", decided_at: null });
  db.rpcs.decide_approval = (a) => {
    const row = db.tables.approvals.find((x) => x.id === a.p_id && x.workspace_id === a.p_ws && x.status === "pending");
    if (!row) return [];
    Object.assign(row, { status: "running", decided_by: a.p_by, ...(a.p_input ? { input: a.p_input } : {}) });
    return [{ ...row }];
  };
  db.rpcs.finish_approval = (a) => Object.assign(db.tables.approvals.find((x) => x.id === a.p_id)!, { status: a.p_status, result: a.p_result }) && true;
  const decide = (id: number, input?: Record<string, unknown>) =>
    approvals.POST(new Request(`https://app.test/api/approvals/${id}`, { method: "POST", headers: { Authorization: "Bearer editor1" }, body: JSON.stringify({ workspaceId: WS, action: "approve", ...(input ? { input } : {}) }) }), { params: Promise.resolve({ id: String(id) }) });
  // The owner edits the card to publish it at once: it is still made as a draft.
  const out = await (await decide(Number(ap.id), { title: "Roof repair", content: "<p>Fix it</p>", status: "publish" })).json();
  assert.equal(out.status, "done");
  assert.match(out.result, /^Draft page saved on WordPress\. Preview it here: https:\/\/ana\.example\/\?page_id=\d+&preview=true$/);
  assert.equal((wp.writes()[0].body as { status: string }).status, "draft");

  // The owner revokes the password in WordPress: the next read marks the connection broken.
  wp.revoke();
  const list = set.tools.find((t) => t.definition.name === "wordpress_list_pages")!;
  const r = await list.run({}, { workspace: ws, agent: "web", threadId: "t", trust: 0, emit: () => {} });
  assert.deepEqual(r, { content: "WordPress didn't accept the login. Connect WordPress again in Settings, Apps.", isError: true });
  assert.equal(db.tables.wordpress_sites[0].status, "reconnect");
  assert.match(String(db.tables.wordpress_logins[0].last_error), /didn't accept the login/);
});
