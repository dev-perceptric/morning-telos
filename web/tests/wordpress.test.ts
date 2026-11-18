// Self-hosted WordPress for Hephaestus (src/lib/wordpress): the site's address, finding WordPress, the sealed connect
// note, the way back, the REST calls and the tools with approvals. A fake WordPress (tests/fakeWordpress.ts) and fake
// DNS: nothing reaches a real site, Composio or Anthropic.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import type { TeamWorkspace, ToolContext, ToolDef, Trust } from "../src/lib/agentLoop.ts";
import type { NewApproval } from "../src/lib/approvals.ts";
import type { ActivityRow } from "../src/lib/productTools.ts";
import { openWith, sealWith, type Keyring } from "../src/lib/sealing.ts";
import { safeAgent, safeFetch, safeRequest, type Dns } from "../src/lib/siteFetch.ts";
import { finishConnect, startConnect, type FinishDeps } from "../src/lib/wordpress/connect.ts";
import type { WpRow } from "../src/lib/wordpress/store.ts";
import { isWordpressApproval, mayUseWordpress, previewLink, runWordpressApproval, WP_MISSING, WP_PRODUCT, WP_TOOLS, WP_WRITES, wordpressToolSource, type WpToolDeps } from "../src/lib/wordpress/tools.ts";
import {
  authorizeUrl,
  discover,
  passwordAad,
  readWpState,
  requestUrl,
  sameSite,
  signWpState,
  siteAddress,
  whoAmI,
  WP_APP_ID,
  WP_APP_NAME,
  WP_MESSAGES,
  WP_STATE_TTL_MS,
  wpCall,
  WpError,
} from "../src/lib/wordpress/wordpress.ts";
import { ORDER, type AgentKey } from "../src/lib/team.ts";
import { API, fakeWordpress, IMAGE, LOGIN, PASSWORD, SITE } from "./fakeWordpress.ts";
import { withSoon } from "./soon.ts";

const WS_ID = "11111111-2222-4333-8444-555555555555";
const OTHER_ID = "11111111-2222-4333-8444-666666666666";
const WS: TeamWorkspace = { id: WS_ID, name: "Ana's Bakery", website: "ana.example", plan: "trial", status: "trialing", trial_ends_at: new Date(Date.now() + 864e6).toISOString(), period_start: new Date().toISOString() };
const ring = (): Keyring => ({ current: "t1", keys: new Map([["t1", randomBytes(32)]]) });
const noWait = async () => {};
const ctx = (agent: AgentKey, trust: Trust = 0, ws = WS): ToolContext => ({ workspace: ws, agent, threadId: "t-1", trust, emit: () => {} });
const tool = (tools: ToolDef[], name: string) => tools.find((t) => t.definition.name === name)!;
const fakeDns = (answers: Record<string, string[]>): Dns => (host, cb) => {
  const list = answers[host];
  if (!list) return cb(Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: "ENOTFOUND" }), []);
  cb(null, list.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })));
};

// ─────────────── the address and finding WordPress ───────────────

test("siteAddress: https only, a plain address gets https, private and local addresses and other ports are refused", () => {
  assert.deepEqual(siteAddress("anasbakery.com"), { ok: true, site: "https://anasbakery.com" });
  assert.deepEqual(siteAddress(" https://Ana.Example/blog/ "), { ok: true, site: "https://ana.example/blog" });
  assert.deepEqual(siteAddress("https://ana.example/?x=1#top"), { ok: true, site: "https://ana.example" });
  assert.deepEqual(siteAddress("http://ana.example"), { ok: false, error: WP_MESSAGES.https });
  for (const ip of ["https://10.0.0.5", "https://127.0.0.1", "https://169.254.169.254", "https://[::1]", "192.168.1.20"]) assert.deepEqual(siteAddress(ip), { ok: false, error: WP_MESSAGES.private }, ip);
  for (const bad of ["", "   ", "https://localhost", "https://wp.local", "intranet", "ftp://ana.example", "https://ana.example:8443", "https://user:pw@ana.example", "ana .example", 42, null]) assert.deepEqual(siteAddress(bad), { ok: false, error: WP_MESSAGES.badAddress }, String(bad));
});

test("sameSite: same host and path over https, any ending slash or host case; nothing else", () => {
  assert.equal(sameSite("https://ana.example", "https://ANA.example/"), true);
  assert.equal(sameSite("https://ana.example/blog/", "https://ana.example/blog"), true);
  assert.equal(sameSite("https://ana.example", "https://evil.example"), false);
  assert.equal(sameSite("https://ana.example/blog", "https://ana.example"), false);
  assert.equal(sameSite("http://ana.example", "https://ana.example"), false);
  assert.equal(sameSite("", "https://ana.example"), false);
});

test("discover: finds the Approve screen in /wp-json/; says plainly when Application Passwords are off or it isn't WordPress", async () => {
  const wp = fakeWordpress();
  const d = await discover(SITE, { fetch: wp.fetch });
  assert.deepEqual(d, { ok: true, found: { site: SITE, api: API, name: "Ana's Bakery", authorize: `${SITE}/wp-admin/authorize-application.php` } });
  assert.equal(wp.calls[0].url, API);
  assert.equal(wp.calls[0].headers.authorization, undefined, "no login is sent while looking");
  assert.deepEqual(await discover(SITE, { fetch: fakeWordpress({ appPasswords: false }).fetch }), { ok: false, error: WP_MESSAGES.noAppPasswords });
  const notWp = (async () => new Response("<html>Hi</html>", { status: 200, headers: { "content-type": "text/html" } })) as never;
  assert.deepEqual(await discover(SITE, { fetch: notWp }), { ok: false, error: WP_MESSAGES.notWordpress });
  // A site that sends us to http is refused.
  const toHttp = (async () => new Response(null, { status: 301, headers: { location: "http://ana.example/wp-json/" } })) as never;
  assert.deepEqual(await discover(SITE, { fetch: toHttp }), { ok: false, error: WP_MESSAGES.https });
});

test("discover: a name that resolves to a private address is refused at connect time, before anything is sent", async () => {
  // The real safe fetch, with fake DNS: ana.example points into the private network (DNS rebinding).
  const get = safeFetch(safeAgent(fakeDns({ "ana.example": ["10.0.0.7"], "mixed.example": ["93.184.216.34", "127.0.0.1"] })));
  assert.deepEqual(await discover("https://ana.example", { fetch: get }), { ok: false, error: WP_MESSAGES.private });
  assert.deepEqual(await discover("https://mixed.example", { fetch: get }), { ok: false, error: WP_MESSAGES.private });
  // safeRequest itself: https only, and a redirect to the metadata address is never followed.
  let sent = 0;
  const hop = (async () => {
    sent++;
    return new Response(null, { status: 302, headers: { location: "https://169.254.169.254/latest/meta-data" } });
  }) as never;
  const a = await safeRequest("https://ana.example/wp-json/", { fetch: hop, follow: true });
  assert.equal(a.reached, false);
  assert.equal(sent, 1);
  assert.equal((await safeRequest("http://ana.example/", { fetch: hop })).reached, false);
  assert.equal(sent, 1);
});

test("safeRequest: a call that carries a login never follows a redirect", async () => {
  let n = 0;
  const hop = (async () => {
    n++;
    return new Response(null, { status: 302, headers: { location: "https://elsewhere.example/" } });
  }) as never;
  const a = await safeRequest("https://ana.example/wp-json/wp/v2/pages", { fetch: hop, follow: true, headers: { Authorization: "Basic x" } });
  assert.deepEqual(a.reached ? [a.status, a.location] : null, [302, "https://elsewhere.example/"]);
  assert.equal(n, 1);
});

// ─────────────── the connect note and the way there ───────────────

test("the connect note: sealed, tied to the workspace, person and site, safe in an address, and good for 15 minutes", () => {
  const r = ring();
  const now = Date.now();
  const s = signWpState(r, { ws: WS_ID, user: "owner1", site: SITE, api: API }, now);
  assert.match(s, /^[A-Za-z0-9_-]+$/, "base64url: WordPress can add its own query to the address");
  assert.deepEqual(readWpState(r, s, now), { ws: WS_ID, user: "owner1", site: SITE, api: API, exp: now + WP_STATE_TTL_MS });
  assert.equal(WP_STATE_TTL_MS, 15 * 60_000);
  assert.equal(readWpState(r, s, now + WP_STATE_TTL_MS + 1), null, "expired");
  assert.equal(readWpState(ring(), s, now), null, "another server's key");
  const mid = Math.floor(s.length / 2);
  assert.equal(readWpState(r, `${s.slice(0, mid)}${s[mid] === "A" ? "B" : "A"}${s.slice(mid + 1)}`, now), null, "changed");
  assert.equal(readWpState(r, "", now), null);
  // A note sealed for Composio's connect can't be used here.
  assert.equal(readWpState(r, Buffer.from(sealWith(r, JSON.stringify({ ws: WS_ID, user: "u", site: SITE, api: API, exp: now + 1e6 }), "composio-connect")).toString("base64url"), now), null);
});

test("startConnect: finds WordPress and links to its Approve screen with our name, our fixed id and the way back", async () => {
  const r = ring();
  const wp = fakeWordpress();
  const out = await startConnect({ ring: r, ws: WS_ID, user: "owner1", site: "ana.example", origin: "https://chat.morningtelos.com/", net: { fetch: wp.fetch } });
  assert.ok(out.ok);
  const u = new URL(out.ok ? out.url : "");
  assert.equal(u.origin + u.pathname, `${SITE}/wp-admin/authorize-application.php`);
  assert.equal(u.searchParams.get("app_name"), WP_APP_NAME);
  assert.equal(u.searchParams.get("app_id"), WP_APP_ID);
  assert.match(WP_APP_ID, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const back = new URL(u.searchParams.get("success_url")!);
  assert.equal(back.origin + back.pathname, "https://chat.morningtelos.com/api/apps/wordpress/callback");
  assert.deepEqual(readWpState(r, back.searchParams.get("state")!)?.site, SITE);
  const reject = new URL(u.searchParams.get("reject_url")!);
  assert.equal(reject.searchParams.get("rejected"), "1");
  assert.equal(reject.searchParams.get("state"), back.searchParams.get("state"));
  // http and private addresses never reach the network.
  const before = wp.calls.length;
  assert.deepEqual(await startConnect({ ring: r, ws: WS_ID, user: "owner1", site: "http://ana.example", origin: "https://x.test", net: { fetch: wp.fetch } }), { ok: false, error: WP_MESSAGES.https });
  assert.deepEqual(await startConnect({ ring: r, ws: WS_ID, user: "owner1", site: "https://10.1.2.3", origin: "https://x.test", net: { fetch: wp.fetch } }), { ok: false, error: WP_MESSAGES.private });
  assert.equal(wp.calls.length, before);
  assert.equal(authorizeUrl({ authorize: "https://ana.example/wp-admin/authorize-application.php" }, "https://x.test/cb?state=s").includes("app_name=Morning+Telos"), true);
});

// ─────────────── the way back ───────────────

function back(o: { role?: string | null; wp?: ReturnType<typeof fakeWordpress> } = {}) {
  const r = ring();
  const wp = o.wp ?? fakeWordpress();
  const saved: Parameters<FinishDeps["save"]>[0][] = [];
  const deps: FinishDeps = { ring: r, roleOf: async (ws, user) => (ws === WS_ID && user === "owner1" ? (o.role === undefined ? "owner" : o.role) : null), save: async (row) => void saved.push(row), net: { fetch: wp.fetch, sleep: noWait } };
  const state = signWpState(r, { ws: WS_ID, user: "owner1", site: SITE, api: API });
  const q = (extra: Record<string, string>) => new URLSearchParams({ state, ...extra });
  return { r, wp, saved, deps, state, q };
}

test("finishConnect: tests the login with one read, then saves it sealed for this workspace only", async () => {
  const b = back();
  const out = await finishConnect(b.q({ site_url: `${SITE}/`, user_login: LOGIN, password: PASSWORD }), b.deps);
  assert.deepEqual(out, { ok: true, ws: WS_ID });
  assert.deepEqual(b.wp.calls.map((c) => [c.method, c.path, c.query.context]), [["GET", "/wp-json/wp/v2/users/me", "edit"]]);
  assert.equal(b.saved.length, 1);
  const row = b.saved[0];
  assert.deepEqual({ ...row, sealed: "" }, { ws: WS_ID, site: SITE, login: LOGIN, api: API, sealed: "", userId: "owner1" });
  assert.doesNotMatch(row.sealed, new RegExp(PASSWORD.split(" ")[0]));
  assert.equal(openWith(b.r, row.sealed, passwordAad(WS_ID)), PASSWORD);
  assert.throws(() => openWith(b.r, row.sealed, passwordAad(OTHER_ID)), "sealed to this workspace");
  assert.equal(passwordAad(WS_ID), `${WS_ID}:wordpress`);
});

test("finishConnect refuses a refusal, an expired or changed note, another site, someone no longer an admin, and a login that doesn't work", async () => {
  const b = back();
  const good = { site_url: SITE, user_login: LOGIN, password: PASSWORD };
  assert.deepEqual(await finishConnect(b.q({ success: "false" }), b.deps), { ok: false, error: WP_MESSAGES.denied, ws: WS_ID });
  assert.deepEqual(await finishConnect(b.q({ rejected: "1" }), b.deps), { ok: false, error: WP_MESSAGES.denied, ws: WS_ID });
  assert.deepEqual(await finishConnect(new URLSearchParams({ state: signWpState(b.r, { ws: WS_ID, user: "owner1", site: SITE, api: API }, Date.now() - 16 * 60_000), ...good }), b.deps), { ok: false, error: WP_MESSAGES.expired });
  const mid = Math.floor(b.state.length / 2);
  const changed = `${b.state.slice(0, mid)}${b.state[mid] === "A" ? "B" : "A"}${b.state.slice(mid + 1)}`;
  assert.deepEqual(await finishConnect(new URLSearchParams({ state: changed, ...good }), b.deps), { ok: false, error: WP_MESSAGES.expired });
  assert.deepEqual(await finishConnect(b.q({ ...good, site_url: "https://evil.example" }), b.deps), { ok: false, error: WP_MESSAGES.wrongSite, ws: WS_ID });
  assert.deepEqual(await finishConnect(b.q({ site_url: SITE, user_login: LOGIN }), b.deps), { ok: false, error: WP_MESSAGES.denied, ws: WS_ID });
  for (const role of ["editor", "viewer", null]) {
    const x = back({ role });
    assert.deepEqual(await finishConnect(x.q(good), x.deps), { ok: false, error: "Only owners and admins can connect and disconnect apps.", ws: WS_ID }, String(role));
    assert.equal(x.wp.calls.length, 0, "the login isn't even tried");
  }
  assert.deepEqual(await finishConnect(b.q({ ...good, password: "wrong one" }), b.deps), { ok: false, error: WP_MESSAGES.loginFailed, ws: WS_ID });
  assert.deepEqual(b.saved, [], "nothing saved");
  // An admin may connect too.
  const admin = back({ role: "admin" });
  assert.equal((await finishConnect(admin.q(good), admin.deps)).ok, true);
});

// ─────────────── calling the site ───────────────

test("wpCall: Basic auth with the login, only under the REST root; a hiccup on a read is tried again, a change is not", async () => {
  const wp = fakeWordpress();
  const login = { api: API, login: LOGIN, password: PASSWORD };
  const me = await whoAmI(login, { fetch: wp.fetch });
  assert.deepEqual(me, { id: 1, name: "Ana" });
  assert.equal(wp.calls[0].headers.authorization, `Basic ${Buffer.from(`${LOGIN}:${PASSWORD}`).toString("base64")}`);
  assert.throws(() => requestUrl(API, "../wp-admin"), WpError);
  assert.throws(() => requestUrl(API, "/etc"), WpError);
  assert.equal(requestUrl(API, "wp/v2/pages", { page: 2, search: undefined }), `${API}wp/v2/pages?page=2`);
  // A read: 503 then fine.
  wp.failNext.push({ path: /pages/, status: 503 });
  const waits: number[] = [];
  const pages = await wpCall(login, { method: "GET", path: "wp/v2/pages" }, { fetch: wp.fetch, sleep: async (ms) => void waits.push(ms) });
  assert.ok(Array.isArray(pages));
  assert.deepEqual(waits, [1000]);
  // A change that hit a 500 isn't sent twice.
  wp.failNext.push({ path: /pages/, status: 500 });
  const before = wp.writes().length;
  await assert.rejects(wpCall(login, { method: "POST", path: "wp/v2/pages", json: { title: "x" } }, { fetch: wp.fetch, sleep: noWait }), (e: WpError) => e.kind === "busy");
  assert.equal(wp.writes().length, before + 1);
  // WordPress says the login is gone: one short line.
  await assert.rejects(wpCall({ ...login, password: "nope" }, { method: "GET", path: "wp/v2/pages" }, { fetch: wp.fetch }), (e: WpError) => e.kind === "login" && e.message === "WordPress didn't accept the login. Connect WordPress again in Settings, Apps.");
  // The site sent the login somewhere else: not followed.
  wp.failNext.push({ path: /pages/, status: 301, headers: { location: "https://other.example/" } });
  await assert.rejects(wpCall(login, { method: "GET", path: "wp/v2/pages" }, { fetch: wp.fetch }), (e: WpError) => e.kind === "moved");
  assert.ok(!wp.calls.some((c) => c.url.startsWith("https://other.example")));
  wp.failNext.push({ path: /pages/, status: 403, body: { code: "rest_cannot_create", message: "Sorry, you are not allowed to <b>create</b> posts as this user." } });
  await assert.rejects(wpCall(login, { method: "POST", path: "wp/v2/pages", json: {} }, { fetch: wp.fetch }), (e: WpError) => e.kind === "refused" && e.message === "Your WordPress user isn't allowed to do that. WordPress said: Sorry, you are not allowed to create posts as this user.");
});

// ─────────────── the tools ───────────────

function setup(o: { row?: Partial<WpRow> | null; wp?: ReturnType<typeof fakeWordpress> } = {}) {
  const r = ring();
  const wp = o.wp ?? fakeWordpress();
  const row: WpRow | null = o.row === null ? null : { workspace_id: WS_ID, site_url: SITE, user_login: LOGIN, status: "active", connected_by: "owner1", created_at: "2026-11-18", api_root: API, sealed_password: sealWith(r, PASSWORD, passwordAad(WS_ID)), ...o.row };
  const approvals: (NewApproval & { id: number })[] = [];
  const activity: ActivityRow[] = [];
  const broken: string[] = [];
  const deps: WpToolDeps = {
    site: async (ws) => (row && row.workspace_id === ws ? row : null),
    openPassword: (sealed, ws) => openWith(r, sealed, passwordAad(ws)),
    saveApproval: async (a) => {
      approvals.push({ ...a, id: approvals.length + 1 });
      return { id: approvals.length };
    },
    activity: async (x) => void activity.push(x),
    markBroken: async (ws, why) => {
      broken.push(`${ws}: ${why}`);
      if (row) row.status = "reconnect";
    },
    net: { fetch: wp.fetch, sleep: noWait },
  };
  return { wp, row, deps, approvals, activity, broken, source: wordpressToolSource(deps) };
}

test("the WordPress tools: only Hephaestus gets them, only for a connected site that works; a broken one says to connect again", async () => {
  assert.deepEqual(ORDER.filter(mayUseWordpress), ["web"]);
  await withSoon("web", () => assert.equal(mayUseWordpress("web"), false));
  const s = setup();
  const set = await s.source(ctx("web"));
  assert.deepEqual(set.tools.map((t) => t.definition.name), Object.keys(WP_TOOLS));
  assert.deepEqual(set.missing, []);
  assert.deepEqual(WP_WRITES, ["wordpress_add_draft_page", "wordpress_update_page", "wordpress_add_draft_post", "wordpress_update_post", "wordpress_upload_image", "wordpress_publish"]);
  for (const t of set.tools) {
    assert.equal(t.write, WP_WRITES.includes(t.definition.name), t.definition.name);
    assert.doesNotMatch(t.definition.name, /delete|remove|trash/);
    assert.doesNotMatch(t.definition.description, /[–—]/);
    assert.doesNotMatch(JSON.stringify(t.definition), new RegExp(PASSWORD.split(" ")[0]), "the password is never in a tool");
  }
  for (const k of ORDER.filter((x) => x !== "web")) assert.deepEqual(await s.source(ctx(k)), { tools: [], missing: [] }, k);
  assert.deepEqual(await setup({ row: null }).source(ctx("web")), { tools: [], missing: [] });
  assert.deepEqual(await setup({ row: { status: "reconnect" } }).source(ctx("web")), { tools: [], missing: [WP_MISSING] });
  // Another workspace's site is never offered.
  assert.deepEqual(await s.source(ctx("web", 0, { ...WS, id: OTHER_ID })), { tools: [], missing: [] });
  // A registry is for one workspace and teammate.
  assert.equal((await tool(set.tools, "wordpress_list_pages").run({}, ctx("web", 0, { ...WS, id: OTHER_ID }))).content, "That tool isn't available.");
});

test("reads run at once, each with its own REST request", async () => {
  const s = setup();
  const set = await s.source(ctx("web"));
  const read = async (name: string, input: Record<string, unknown> = {}) => {
    const r = await tool(set.tools, name).run(input, ctx("web"));
    assert.equal(r.isError, undefined, `${name}: ${r.content}`);
    return JSON.parse(JSON.parse(r.content).data);
  };
  const info = await read("wordpress_site_info");
  assert.deepEqual(info, { name: "Ana's Bakery", description: "Bread", address: SITE, wordpress: SITE, time_zone: "Asia/Ho_Chi_Minh", seo_plugin: "Yoast" });
  const pages = await read("wordpress_list_pages", { search: "home" });
  assert.deepEqual(pages.map((p: { id: number; title: string }) => [p.id, p.title]), [[7, "Home"]]);
  const page = await read("wordpress_get_page", { id: 7 });
  assert.match(page.content, /wp:paragraph/);
  const posts = await read("wordpress_list_posts", { status: "draft", category: 3 });
  assert.equal(posts[0].preview, `${SITE}/?p=8&preview=true`, "a draft shows its preview link");
  await read("wordpress_get_post", { id: "8" });
  assert.deepEqual(await read("wordpress_list_categories"), [{ id: 3, name: "News", slug: "news", parent: 0, posts: 1 }]);
  assert.deepEqual(
    s.wp.calls.map((c) => [c.method, c.path, c.query]),
    [
      ["GET", "/wp-json/", { _fields: "name,description,url,home,timezone_string,namespaces" }],
      ["GET", "/wp-json/wp/v2/pages", { context: "edit", per_page: "20", page: "1", status: "publish,future,draft,pending,private", search: "home", _fields: "id,title,status,slug,link,modified,parent" }],
      ["GET", "/wp-json/wp/v2/pages/7", { context: "edit", _fields: "id,title,status,slug,link,modified,parent,excerpt,content" }],
      ["GET", "/wp-json/wp/v2/posts", { context: "edit", per_page: "20", page: "1", status: "draft,pending", _fields: "id,title,status,slug,link,modified,parent,categories", categories: "3" }],
      ["GET", "/wp-json/wp/v2/posts/8", { context: "edit", _fields: "id,title,status,slug,link,modified,parent,excerpt,content,categories" }],
      ["GET", "/wp-json/wp/v2/categories", { per_page: "100", _fields: "id,name,slug,parent,count" }],
    ],
  );
  assert.ok(s.wp.calls.every((c) => c.headers.authorization?.startsWith("Basic ")));
  assert.equal(s.wp.writes().length, 0);
  assert.equal((await tool(set.tools, "wordpress_get_page").run({ id: "x" }, ctx("web"))).isError, true);
  assert.equal((await tool(set.tools, "wordpress_list_pages").run({ status: "trash" }, ctx("web"))).isError, true);
});

test("every change waits for approval with a plain title; inputs are cleaned, and a new page or post is a draft whatever they say", async () => {
  const s = setup();
  const set = await s.source(ctx("web"));
  const asks: [string, Record<string, unknown>][] = [
    ["wordpress_add_draft_page", { title: " Roof repair ", content: "<!-- wp:heading --><h2>Roof repair</h2><!-- /wp:heading -->", slug: "Roof-Repair", status: "publish", date: "2020-01-01", author: 9 }],
    ["wordpress_update_page", { id: 7, content: "<p>New</p>", status: "publish", password: "x" }],
    ["wordpress_add_draft_post", { title: "Tips", content: "<p>Hi</p>", categories: [3], status: "future" }],
    ["wordpress_update_post", { id: "8", title: "Spring menu 2027" }],
    ["wordpress_upload_image", { url: IMAGE, alt_text: "A new roof" }],
    ["wordpress_publish", { type: "page", id: 101 }],
  ];
  for (const [name, input] of asks) {
    const r = await tool(set.tools, name).run(input, ctx("web", 1));
    assert.ok(r.approval, `${name} waits: ${r.content}`);
    assert.match(r.content, /It has not run yet/);
  }
  assert.deepEqual(
    s.approvals.map((a) => [a.agent, a.product, a.tool, a.title, a.input]),
    [
      ["web", "wordpress", "wordpress_add_draft_page", "Add a draft page to WordPress", { title: "Roof repair", content: "<!-- wp:heading --><h2>Roof repair</h2><!-- /wp:heading -->", slug: "roof-repair" }],
      ["web", "wordpress", "wordpress_update_page", "Update a page on WordPress", { id: 7, content: "<p>New</p>" }],
      ["web", "wordpress", "wordpress_add_draft_post", "Add a draft post to WordPress", { title: "Tips", content: "<p>Hi</p>", categories: [3] }],
      ["web", "wordpress", "wordpress_update_post", "Update a post on WordPress", { id: 8, title: "Spring menu 2027" }],
      ["web", "wordpress", "wordpress_upload_image", "Upload an image to WordPress", { url: IMAGE, alt_text: "A new roof" }],
      ["web", "wordpress", "wordpress_publish", "Publish a page or post on WordPress", { type: "page", id: 101 }],
    ],
  );
  for (const a of s.approvals) assert.doesNotMatch(`${a.title} ${a.why}`, /[–—]/);
  assert.match((await tool(set.tools, "wordpress_add_draft_page").run(asks[0][1], ctx("web", 1))).content, /preview link/);
  assert.equal(s.wp.calls.length, 0, "nothing reached the site");
  assert.equal(s.activity[0].text, 'prepared "Add a draft page to WordPress" for your approval');
  // Bad inputs never become an approval.
  for (const [name, input] of [
    ["wordpress_add_draft_page", { title: "x", content: "<script>alert(1)</script>" }],
    ["wordpress_add_draft_page", { title: "x", content: '<a href="javascript:alert(1)">x</a>' }],
    ["wordpress_add_draft_page", { content: "<p>x</p>" }],
    ["wordpress_update_page", { id: 7 }],
    ["wordpress_update_page", { content: "<p>x</p>" }],
    ["wordpress_upload_image", { url: "http://img.example/roof.jpg" }],
    ["wordpress_upload_image", { url: "https://10.0.0.8/roof.jpg" }],
    ["wordpress_publish", { type: "user", id: 1 }],
  ] as const) {
    assert.equal((await tool(set.tools, name).run(input as Record<string, unknown>, ctx("web"))).isError, true, `${name} ${JSON.stringify(input)}`);
  }
  assert.equal(s.approvals.length, 7);
});

test("on autopilot a new page is made as a draft and comes back with its preview link; publishing is its own step", async () => {
  const s = setup();
  const set = await s.source(ctx("web", 2));
  const r = await tool(set.tools, "wordpress_add_draft_page").run({ title: "Roof repair", content: "<p>Fix it</p>", status: "publish" }, ctx("web", 2));
  const data = JSON.parse(JSON.parse(r.content).data);
  assert.equal(data.status, "draft");
  assert.equal(data.preview, `${SITE}/?page_id=101&preview=true`);
  assert.equal(data.edit, `${SITE}/wp-admin/post.php?post=101&action=edit`);
  assert.deepEqual(s.wp.writes().map((c) => [c.path, c.body]), [["/wp-json/wp/v2/pages", { title: "Roof repair", content: "<p>Fix it</p>", status: "draft" }]]);
  assert.equal(s.activity.at(-1)!.text, 'ran "Add a draft page to WordPress" on autopilot');
  await tool(set.tools, "wordpress_publish").run({ type: "page", id: 101 }, ctx("web", 2));
  assert.deepEqual(s.wp.writes().at(-1)!.body, { status: "publish" });
  assert.equal(s.wp.items.find((x) => x.id === 101)!.status, "publish");
  assert.equal(previewLink("not a link"), null);
});

test("runWordpressApproval: checked again before it runs; drafts stay drafts, publish runs only as approved, nothing deletes", async () => {
  const s = setup();
  const run = (tool: string, input: Record<string, unknown>, agent: AgentKey = "web") => runWordpressApproval({ workspace_id: WS_ID, agent, product: WP_PRODUCT, tool, input }, s.deps);
  // An approval edited to publish a new page, or to set a date, still makes a draft.
  const made = await run("wordpress_add_draft_post", { title: "Tips", content: "<p>Hi</p>", status: "publish", date: "2020-01-01" });
  assert.deepEqual(made, { ok: true, text: `Draft post saved on WordPress. Preview it here: ${SITE}/?p=101&preview=true` });
  assert.deepEqual(s.wp.writes().at(-1)!.body, { title: "Tips", content: "<p>Hi</p>", status: "draft" });
  // An update never changes whether it is live.
  const upd = await run("wordpress_update_page", { id: 7, title: "Our home", status: "draft" });
  assert.equal(upd.ok, true);
  assert.match(upd.text, /^The page was updated on WordPress\. See it here: https:\/\/ana\.example\/home\/$/);
  assert.deepEqual(s.wp.writes().at(-1)!.body, { title: "Our home" });
  // The publish runs only for what was approved.
  assert.deepEqual(await run("wordpress_publish", { type: "post", id: 101 }), { ok: true, text: `Published on WordPress. See it here: ${SITE}/draft-101/` });
  assert.deepEqual([s.wp.writes().at(-1)!.path, s.wp.writes().at(-1)!.body], ["/wp-json/wp/v2/posts/101", { status: "publish" }]);
  // Refused: a read, a delete, an unknown tool, edited bad inputs, another teammate, a disconnected or broken site.
  const n = s.wp.calls.length;
  assert.deepEqual(await run("wordpress_list_pages", {}), { ok: false, text: "This change isn't allowed." });
  assert.deepEqual(await run("wordpress_delete_page", { id: 7 }), { ok: false, text: "This change isn't allowed." });
  assert.deepEqual(await run("constructor", {}), { ok: false, text: "This change isn't allowed." });
  assert.deepEqual(await run("wordpress_update_page", { id: 7, content: "<script>x</script>" }), { ok: false, text: "Leave scripts out of the page. Use block markup or clean HTML." });
  assert.deepEqual(await run("wordpress_upload_image", { url: "https://169.254.169.254/latest/meta-data" }), { ok: false, text: "The image's address must be a public https address." });
  assert.deepEqual(await run("wordpress_publish", { type: "page", id: 7 }, "seo"), { ok: false, text: "This teammate can't make this change any more." });
  assert.deepEqual(await runWordpressApproval({ workspace_id: WS_ID, agent: "web", product: "framer", tool: "wordpress_publish", input: {} }, s.deps), { ok: false, text: "This kind of change isn't supported." });
  assert.equal(s.wp.calls.length, n, "none of those reached the site");
  assert.deepEqual(await runWordpressApproval({ workspace_id: OTHER_ID, agent: "web", product: WP_PRODUCT, tool: "wordpress_publish", input: { type: "page", id: 7 } }, s.deps), { ok: false, text: "WordPress isn't connected any more. Connect it in Settings, Apps, then ask again." });
  const lost = setup({ row: { status: "reconnect" } });
  assert.deepEqual(await runWordpressApproval({ workspace_id: WS_ID, agent: "web", product: WP_PRODUCT, tool: "wordpress_publish", input: { type: "page", id: 7 } }, lost.deps), { ok: false, text: "Connect WordPress again in Settings, Apps, then ask again." });
  assert.equal(isWordpressApproval({ product: "wordpress" }), true);
  assert.equal(isWordpressApproval({ product: "wordpress_com" }), false);
});

test("uploading an image: fetched from its public address, sent as the file, then its alt text set; not an image is refused", async () => {
  const s = setup();
  const out = await runWordpressApproval({ workspace_id: WS_ID, agent: "web", product: WP_PRODUCT, tool: "wordpress_upload_image", input: { url: IMAGE, alt_text: "A new roof", title: "Roof" } }, s.deps);
  assert.deepEqual(out, { ok: true, text: `Image added to WordPress. It is here: ${SITE}/wp-content/uploads/roof.jpg` });
  const [img, up, meta] = s.wp.calls;
  assert.equal(img.url, IMAGE);
  assert.equal(img.headers.authorization, undefined, "the WordPress login never goes to the image's host");
  assert.equal(up.path, "/wp-json/wp/v2/media");
  assert.equal(up.headers["content-type"], "image/jpeg");
  assert.equal(up.headers["content-disposition"], 'attachment; filename="roof.jpg"');
  assert.deepEqual([...(up.body as Uint8Array)], [0xff, 0xd8, 0xff, 1, 2, 3]);
  assert.deepEqual([meta.path, meta.body], ["/wp-json/wp/v2/media/55", { alt_text: "A new roof", title: "Roof" }]);
  const html = await runWordpressApproval({ workspace_id: WS_ID, agent: "web", product: WP_PRODUCT, tool: "wordpress_upload_image", input: { url: "https://img.example/page.html" } }, s.deps);
  assert.deepEqual(html, { ok: false, text: "That address isn't a JPEG, PNG, GIF or WebP image." });
});

test("a WordPress that no longer takes the login marks the connection broken and says so in one short line", async () => {
  const s = setup();
  const set = await s.source(ctx("web"));
  s.wp.revoke();
  const r = await tool(set.tools, "wordpress_list_pages").run({}, ctx("web"));
  assert.deepEqual(r, { content: "WordPress didn't accept the login. Connect WordPress again in Settings, Apps.", isError: true });
  assert.deepEqual(s.broken, [`${WS_ID}: WordPress didn't accept the login. Connect WordPress again in Settings, Apps.`]);
  assert.equal(r.content.split("\n").length, 1);
  // From then on the tools are gone and the prompt says to connect again.
  assert.deepEqual(await s.source(ctx("web")), { tools: [], missing: [WP_MISSING] });
  // An approved change that hits it marks it too.
  const t = setup();
  t.wp.revoke();
  assert.deepEqual(await runWordpressApproval({ workspace_id: WS_ID, agent: "web", product: WP_PRODUCT, tool: "wordpress_publish", input: { type: "page", id: 7 } }, t.deps), { ok: false, text: WP_MESSAGES.reconnect });
  assert.equal(t.broken.length, 1);
  // A busy site is not a broken login.
  const u = setup();
  u.wp.failNext.push({ path: /pages/, status: 503 }, { path: /pages/, status: 503 }, { path: /pages/, status: 503 });
  const busy = await tool((await u.source(ctx("web"))).tools, "wordpress_list_pages").run({}, ctx("web"));
  assert.deepEqual([busy.content, u.broken], [WP_MESSAGES.busy, []]);
});
