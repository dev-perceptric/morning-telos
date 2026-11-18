// The customer's own apps through Composio (src/lib/composio): the catalog, the workspace's own Composio user, the
// sealed connect note, connecting and checking an account, sorting actions, and the app tools with approvals.
// A fake Composio (tests/fakeComposio.ts): nothing reaches the real Composio or Anthropic.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { TeamWorkspace, ToolContext, ToolDef, Trust } from "../src/lib/agentLoop.ts";
import type { Approval, NewApproval } from "../src/lib/approvals.ts";
import { AppSetupError, forgetTools, kindOf, runTool, toolsOf, verbOf } from "../src/lib/composio/actions.ts";
import { access, ACTION_TOOL, appToolSource, isAppApproval, missingApp, notConnected, runApproval, SEARCH_TOOL, toolkitOf, type AppToolDeps } from "../src/lib/composio/appAction.ts";
import { APP_ACCESS, appAction, appArgs, appName, APPS, appsFor, changesApps, changeTitle, DIRECT, DIRECT_APPS, directFor, FRAMER_ACTIONS, groupOf, GROUPS, isAppId, isToolkit, publishes, SHOPIFY_ACTIONS, TOOLKITS, WEBFLOW_ACTIONS, WORDPRESS_COM_ACTIONS } from "../src/lib/composio/catalog.ts";
import { composioOn, composioUser, connectable } from "../src/lib/composio/composio.ts";
import { accountLabel, activeAccount, authConfigFor, connectLink, dropAccount, forgetConfigs, readState, signState, STATE_TTL_MS } from "../src/lib/composio/connect.ts";
import { closeApps, type ConnRow } from "../src/lib/composio/store.ts";
import type { ActivityRow } from "../src/lib/productTools.ts";
import type { Keyring } from "../src/lib/sealing.ts";
import { AGENTS, ORDER, type AgentKey } from "../src/lib/team.ts";
import { BASE, fakeComposio, KEY } from "./fakeComposio.ts";
import { fakeDb } from "./server/fakeDb.ts";
import { withSoon } from "./soon.ts";

const ENV = { COMPOSIO_API_KEY: KEY, COMPOSIO_BASE_URL: BASE };
const WS_ID = "11111111-2222-4333-8444-555555555555";
const OTHER_ID = "11111111-2222-4333-8444-666666666666";
const WS: TeamWorkspace = { id: WS_ID, name: "Ana's Bakery", website: "anasbakery.com", plan: "trial", status: "trialing", trial_ends_at: new Date(Date.now() + 864e6).toISOString(), period_start: new Date().toISOString() };
const ring = (): Keyring => ({ current: "t1", keys: new Map([["t1", randomBytes(32)]]) });
const noWait = async () => {};

// ─────────────── the catalog ───────────────

test("catalog: the fourteen apps the team needs, with their Composio slugs, and the SQL check lists the same ones", () => {
  assert.deepEqual(
    APPS.map((a) => a.toolkit),
    ["gmail", "outlook", "googlecalendar", "calendly", "hubspot", "pipedrive", "salesforce", "slack", "zendesk", "help_scout", "framer", "webflow", "wordpress_com", "shopify"],
  );
  for (const a of APPS) {
    assert.ok(a.name && a.blurb && a.forAgents.length, a.toolkit);
    assert.doesNotMatch(a.blurb, /[–—]/);
    for (const k of a.forAgents) assert.ok(ORDER.includes(k), `${a.toolkit}: ${k}`);
  }
  // Composio has no app of its own for these, so they need our own auth config. Framer takes only an API key.
  assert.deepEqual(APPS.filter((a) => !a.managed).map((a) => a.toolkit), ["pipedrive", "help_scout", "framer", "webflow", "wordpress_com", "shopify"]);
  assert.deepEqual(APPS.filter((a) => a.scheme !== "OAUTH2").map((a) => [a.toolkit, a.scheme]), [["framer", "API_KEY"]]);
  // The website builders are their own group on the Apps page, for Hephaestus.
  assert.deepEqual(APPS.filter((a) => a.group === "website").map((a) => [a.toolkit, a.name]), [["framer", "Framer"], ["webflow", "Webflow"], ["wordpress_com", "WordPress.com"], ["shopify", "Shopify"]]);
  assert.deepEqual(GROUPS.at(-1), { id: "website", label: "Website" });
  // The newest migration that sets the list (020) names the same apps.
  const sql = readFileSync(new URL("../supabase/020_wordpress.sql", import.meta.url), "utf8");
  const listed = sql.match(/toolkit in \(([^)]+)\)/)![1].split(",").map((s) => s.trim().replace(/'/g, ""));
  assert.deepEqual(listed.sort(), Object.keys(TOOLKITS).sort());
});

test("catalog: each app's own auth config can be set in .env.example (and so in web-compose.yml)", () => {
  const example = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
  for (const k of ["COMPOSIO_API_KEY", "COMPOSIO_BASE_URL", ...APPS.map((a) => `COMPOSIO_AUTH_CONFIG_${a.toolkit.toUpperCase()}`)]) assert.match(example, new RegExp(`^${k}=$`, "m"), k);
});

test("access: Athena reads every app; Iris, Hora, Hermes, Hestia and Hephaestus use their own apps and may change things; the rest get none", () => {
  assert.deepEqual(Object.keys(APP_ACCESS).sort(), ["chief", "email", "forms", "sales", "support", "web"]);
  assert.deepEqual(access("chief"), { toolkits: APPS.map((a) => a.toolkit), reads: true });
  assert.deepEqual(access("email"), { toolkits: ["gmail", "outlook"], reads: false });
  assert.deepEqual(access("forms"), { toolkits: ["googlecalendar", "calendly", "gmail", "outlook"], reads: false });
  assert.deepEqual(access("sales"), { toolkits: ["gmail", "outlook", "googlecalendar", "calendly", "hubspot", "pipedrive", "salesforce"], reads: false });
  assert.deepEqual(access("support"), { toolkits: ["gmail", "outlook", "slack", "zendesk", "help_scout"], reads: false });
  // Hephaestus: the owner's own site builder.
  assert.deepEqual(access("web"), { toolkits: ["framer", "webflow", "wordpress_com", "shopify"], reads: false });
  // And his own WordPress site, which Morning Telos connects itself.
  assert.deepEqual(directFor("web", false), ["wordpress"]);
  for (const k of ORDER.filter((x) => x !== "web")) assert.deepEqual(directFor(k, false), [], k);
  assert.deepEqual(directFor("web", true), [], "coming soon gets nothing");
  for (const k of ["social", "seo"] as AgentKey[]) assert.deepEqual(access(k), { toolkits: [], reads: true }, k);
  // The Apps page's "for" list says the same as the access map.
  for (const a of APPS) assert.deepEqual([...a.forAgents].sort(), ORDER.filter((k) => k !== "chief" && access(k).toolkits.includes(a.toolkit)).sort(), a.toolkit);
  // Every toolkit named is a real one.
  for (const v of Object.values(APP_ACCESS)) if (Array.isArray(v.toolkits)) for (const t of v.toolkits) assert.ok(TOOLKITS[t], t);
  // Who gets the Ask me first or Autopilot setting for apps.
  assert.deepEqual(ORDER.filter((k) => changesApps(k)), ["sales", "support", "forms", "email", "web"]);
  // A teammate that is coming soon gets nothing, whatever the map says.
  assert.deepEqual(appsFor("sales", true), { toolkits: [], reads: true });
  assert.equal(changesApps("sales", true), false);
  assert.equal(AGENTS.chief.readOnly, true);
});

test("access: a teammate marked coming soon loses its apps", async () => {
  await withSoon("support", () => assert.deepEqual(access("support"), { toolkits: [], reads: true }));
  assert.equal(access("support").reads, false);
});

test("connectable: needs the server key; Pipedrive, Help Scout and the website builders also need our own auth config", () => {
  assert.equal(composioOn({}), false);
  assert.equal(connectable(TOOLKITS.gmail, {}), false);
  assert.equal(connectable(TOOLKITS.gmail, ENV), true);
  assert.equal(connectable(TOOLKITS.pipedrive, ENV), false);
  assert.equal(connectable(TOOLKITS.pipedrive, { ...ENV, COMPOSIO_AUTH_CONFIG_PIPEDRIVE: "ac_pd" }), true);
  assert.equal(connectable(TOOLKITS.help_scout, { ...ENV, COMPOSIO_AUTH_CONFIG_HELP_SCOUT: " ac_hs " }), true);
  assert.equal(connectable(undefined, ENV), false);
  // Framer takes only an API key: it still needs the API key auth config we make in Composio.
  for (const t of ["framer", "webflow", "wordpress_com", "shopify"]) {
    assert.equal(connectable(TOOLKITS[t], ENV), false, t);
    assert.equal(connectable(TOOLKITS[t], { ...ENV, [`COMPOSIO_AUTH_CONFIG_${t.toUpperCase()}`]: "ac_ours" }), true, t);
  }
});

test("composioUser: one Composio user per workspace, never shared, and only for a workspace id", () => {
  assert.equal(composioUser(WS_ID), `mt_${WS_ID}`);
  assert.equal(composioUser(WS_ID.toUpperCase()), `mt_${WS_ID}`);
  assert.notEqual(composioUser(WS_ID), composioUser(OTHER_ID));
  for (const bad of ["", "mt_x", `${WS_ID},${OTHER_ID}`, "../x"]) assert.throws(() => composioUser(bad), /Not a workspace id/);
});

// ─────────────── the sealed connect note ───────────────

test("connect state: opens only on the server that sealed it, unchanged, within 30 minutes, for a known app", () => {
  const r = ring();
  const now = Date.parse("2026-11-18T12:00:00Z");
  const s = signState(r, { ws: WS_ID, user: "u1", toolkit: "gmail" }, now);
  assert.deepEqual(readState(r, s, now + 60_000), { ws: WS_ID, user: "u1", toolkit: "gmail", exp: now + STATE_TTL_MS });
  assert.equal(readState(r, s, now + STATE_TTL_MS + 1), null);
  assert.equal(readState(ring(), s, now), null);
  assert.equal(readState(r, `${s.slice(0, -4)}AAAA`, now), null);
  assert.equal(readState(r, "", now), null);
  assert.equal(readState(r, signState(r, { ws: WS_ID, user: "u1", toolkit: "linkedin" }, now), now), null);
});

// ─────────────── connecting ───────────────

test("authConfigFor: an auth config set by hand, else Composio's managed one, else a new managed one; never for an app that needs ours", async () => {
  forgetConfigs();
  const c = fakeComposio({ configs: [{ id: "ac_hub", toolkit: "hubspot", is_composio_managed: true }] });
  const net = { fetcher: c.fetch, env: ENV };
  assert.equal(await authConfigFor(TOOLKITS.hubspot, net), "ac_hub");
  assert.equal(await authConfigFor(TOOLKITS.gmail, { ...net, env: { ...ENV, COMPOSIO_AUTH_CONFIG_GMAIL: "ac_ours" } }), "ac_ours");
  const made = await authConfigFor(TOOLKITS.gmail, net);
  assert.match(made, /^ac_/);
  assert.deepEqual(c.calls.find((x) => x.method === "POST")!.body, { toolkit: { slug: "gmail" }, auth_config: { type: "use_composio_managed_auth" } });
  await assert.rejects(authConfigFor(TOOLKITS.pipedrive, net), /COMPOSIO_AUTH_CONFIG_PIPEDRIVE/);
  forgetConfigs();
});

test("connectLink: the hosted page for the workspace's own Composio user, coming back to our callback", async () => {
  forgetConfigs();
  const c = fakeComposio();
  const out = await connectLink("gmail", composioUser(WS_ID), "https://app.test/api/apps/composio?state=x", { fetcher: c.fetch, env: ENV });
  assert.match(out.url, /^https:\/\/connect\.composio\.test\/link\//);
  const link = c.calls.find((x) => x.path === "/api/v3.1/connected_accounts/link")!;
  assert.equal(link.body!.user_id, `mt_${WS_ID}`);
  assert.equal(link.body!.callback_url, "https://app.test/api/apps/composio?state=x");
  await assert.rejects(connectLink("linkedin", "u", "x", { fetcher: c.fetch, env: ENV }), /can't be connected/);
  await assert.rejects(connectLink("gmail", "u", "x", { fetcher: c.fetch, env: {} }), /aren't set up/);
  forgetConfigs();
});

test("activeAccount: only this workspace's account for this app, once ACTIVE; waits while it finishes", async () => {
  const c = fakeComposio();
  const net = { fetcher: c.fetch, env: ENV, sleep: noWait };
  const mine = composioUser(WS_ID);
  const theirs = composioUser(OTHER_ID);
  const ok = c.addAccount(mine, "gmail");
  assert.equal((await activeAccount("gmail", mine, ok, net)).id, ok);
  // Another workspace's account named in the address is refused, even though it's real and ACTIVE.
  const other = c.addAccount(theirs, "gmail");
  await assert.rejects(activeAccount("gmail", mine, other, net), /isn't this workspace's/);
  // The right workspace, the wrong app.
  const hub = c.addAccount(mine, "hubspot");
  await assert.rejects(activeAccount("gmail", mine, hub, net), /isn't this workspace's/);
  // Still finishing: asked again until it's ACTIVE.
  const slow = c.addAccount(mine, "gmail", "INITIATED");
  let waits = 0;
  const done = activeAccount("gmail", mine, slow, { ...net, sleep: async () => void (++waits === 2 && c.finish(slow)) });
  assert.equal((await done).id, slow);
  assert.equal(waits, 2);
  const failed = c.addAccount(mine, "gmail", "FAILED");
  await assert.rejects(activeAccount("gmail", mine, failed, net), /finish connecting/);
  await assert.rejects(activeAccount("gmail", mine, "bad id!", net), /Could not connect/);
});

test("accountLabel reads the connected email through Composio's proxy; an app that won't say gives null", async () => {
  const c = fakeComposio();
  const user = composioUser(WS_ID);
  const id = c.addAccount(user, "gmail");
  assert.equal(await accountLabel("gmail", id, user, { fetcher: c.fetch, env: ENV }), "ana@anasbakery.com");
  assert.equal(await accountLabel("gmail", id, composioUser(OTHER_ID), { fetcher: c.fetch, env: ENV }), null);
  assert.equal(await accountLabel("zendesk", id, user, { fetcher: c.fetch, env: ENV }), null);
  assert.equal(await accountLabel("outlook", c.addAccount(user, "outlook"), user, { fetcher: c.fetch, env: ENV }), null);
});

test("dropAccount removes the account at Composio and never throws", async () => {
  const c = fakeComposio();
  const id = c.addAccount(composioUser(WS_ID), "gmail");
  assert.equal(await dropAccount(id, { fetcher: c.fetch, env: ENV }), true);
  assert.equal(c.accounts.length, 0);
  assert.equal(await dropAccount(id, { fetcher: c.fetch, env: ENV }), false);
  assert.equal(await dropAccount(id, { fetcher: c.fetch, env: {} }), false);
  assert.equal(await dropAccount("../x", { fetcher: c.fetch, env: ENV }), false);
});

// ─────────────── sorting and running actions ───────────────

test("kindOf: reads run, changes wait, deleting and keys never run, from the name, Composio's hints and the verb list", () => {
  const k = (slug: string, tags: string[] = [], toolkit = "gmail") => kindOf(toolkit, { slug, name: slug, description: "", tags }).kind;
  assert.equal(verbOf("gmail", "GMAIL_FETCH_EMAILS"), "FETCH");
  assert.equal(verbOf("hubspot", "HUBSPOT_BATCH_UPDATE_DEALS"), "UPDATE");
  assert.equal(verbOf("googlecalendar", "GOOGLECALENDAR_FIND_FREE_SLOTS"), "FIND");
  for (const s of ["GMAIL_FETCH_EMAILS", "GMAIL_GET_PROFILE", "GMAIL_LIST_THREADS", "GMAIL_SEARCH_PEOPLE"]) assert.equal(k(s), "read", s);
  assert.equal(k("HELP_SCOUT_LIST_CONVERSATIONS", [], "help_scout"), "read");
  assert.equal(k("GOOGLECALENDAR_FIND_FREE_SLOTS", [], "googlecalendar"), "read");
  // Composio's read-only hint counts, unless the name says it changes something.
  assert.equal(k("GMAIL_THREAD_SUMMARY", ["readOnlyHint"]), "read");
  assert.equal(k("GMAIL_SEND_SUMMARY", ["readOnlyHint"]), "write");
  for (const s of ["GMAIL_SEND_EMAIL", "GMAIL_REPLY_TO_THREAD", "GMAIL_CREATE_EMAIL_DRAFT", "GMAIL_ADD_LABEL_TO_EMAIL", "GMAIL_MARK_READ"]) assert.equal(k(s), "write", s);
  assert.equal(k("HUBSPOT_UPDATE_DEAL", [], "hubspot"), "write");
  assert.equal(k("ZENDESK_REPLY_TICKET", [], "zendesk"), "write");
  for (const s of ["GMAIL_DELETE_MESSAGE", "GMAIL_MOVE_TO_TRASH", "GMAIL_ARCHIVE_THREAD"]) assert.equal(k(s), "blocked", s);
  assert.equal(k("GMAIL_PATCH_THING", ["destructiveHint"]), "blocked");
  assert.equal(k("GMAIL_GET_API_KEY"), "blocked");
  assert.equal(k("GMAIL_CREATE_WEBHOOK"), "blocked");
  assert.equal(k("HUBSPOT_LIST_CONTACTS"), "blocked", "another app's action");
  assert.equal(k("LINKEDIN_GET_PROFILE", [], "linkedin"), "blocked");
});

test("runTool: runs on the connection's account and Composio user; hiccups are tried again; a gone account says connect again", async () => {
  forgetTools();
  const c = fakeComposio();
  const user = composioUser(WS_ID);
  const id = c.addAccount(user, "gmail");
  const net = { fetcher: c.fetch, env: ENV, sleep: noWait };
  assert.deepEqual(await runTool({ toolkit: "gmail", account: id, user }, "GMAIL_FETCH_EMAILS", { query: "is:unread" }, net), { ran: "GMAIL_FETCH_EMAILS", args: { query: "is:unread" } });
  assert.deepEqual(c.ran.at(-1), { slug: "GMAIL_FETCH_EMAILS", account: id, user, args: { query: "is:unread" } });
  c.failNext.push({ path: /execute/, status: 503 }, { path: /execute/, status: 429 });
  assert.ok(await runTool({ toolkit: "gmail", account: id, user }, "GMAIL_FETCH_EMAILS", {}, net));
  // Another workspace's user can't run on this account.
  await assert.rejects(runTool({ toolkit: "gmail", account: id, user: composioUser(OTHER_ID) }, "GMAIL_FETCH_EMAILS", {}, net), (e) => e instanceof AppSetupError && /Connect Gmail again in Settings, Apps\./.test(e.message));
  c.finish(id, "EXPIRED");
  await assert.rejects(runTool({ toolkit: "gmail", account: id, user }, "GMAIL_FETCH_EMAILS", {}, net), /Connect Gmail again in Settings, Apps\./);
  await assert.rejects(runTool({ toolkit: "gmail", account: id, user }, "GMAIL_FETCH_EMAILS", {}, { ...net, env: {} }), /aren't set up/);
  const tools = await toolsOf("gmail", net);
  assert.deepEqual(
    tools.map((t) => [t.slug, t.kind]),
    [["GMAIL_FETCH_EMAILS", "read"], ["GMAIL_GET_PROFILE", "read"], ["GMAIL_SEND_EMAIL", "write"], ["GMAIL_CREATE_EMAIL_DRAFT", "write"], ["GMAIL_DELETE_MESSAGE", "blocked"], ["GMAIL_MOVE_TO_TRASH", "blocked"], ["GMAIL_REPLY_TO_THREAD", "write"]],
  );
  forgetTools();
});

// ─────────────── the app tools ───────────────

function setup(o: { on?: boolean; rows?: Partial<ConnRow>[]; access?: Partial<Record<AgentKey, { toolkits: string[]; reads: boolean }>> } = {}) {
  forgetTools();
  const c = fakeComposio();
  const user = composioUser(WS_ID);
  const gmail = c.addAccount(user, "gmail");
  const hub = c.addAccount(user, "hubspot");
  const theirs = c.addAccount(composioUser(OTHER_ID), "gmail");
  const base: ConnRow[] = [
    { id: "r1", workspace_id: WS_ID, toolkit: "gmail", composio_account: gmail, status: "active", account_label: "ana@anasbakery.com", connected_by: "u1", created_at: "2026-11-18" },
    { id: "r2", workspace_id: WS_ID, toolkit: "hubspot", composio_account: hub, status: "active", account_label: null, connected_by: "u1", created_at: "2026-11-18" },
    { id: "r3", workspace_id: OTHER_ID, toolkit: "slack", composio_account: theirs, status: "active", account_label: null, connected_by: "u9", created_at: "2026-11-18" },
  ];
  const rows = (o.rows as ConnRow[] | undefined) ?? base;
  const approvals: (NewApproval & { id: number })[] = [];
  const activity: ActivityRow[] = [];
  const reconnects: string[] = [];
  const deps: AppToolDeps = {
    on: o.on ?? true,
    // Like the server's query, the rows come back for one workspace (a stray row is dropped by the source too).
    connections: async (ws) => rows.filter((r) => r.workspace_id === ws || r.id === "r3"),
    saveApproval: async (a) => {
      approvals.push({ ...a, id: approvals.length + 1 });
      return { id: approvals.length };
    },
    activity: async (r) => void activity.push(r),
    markReconnect: async (ws, toolkit) => void reconnects.push(`${ws}:${toolkit}`),
    net: { fetcher: c.fetch, env: ENV, sleep: noWait },
    ...(o.access ? { access: (k: AgentKey) => o.access![k] ?? { toolkits: [], reads: true } } : {}),
  };
  return { c, rows, approvals, activity, reconnects, deps, source: appToolSource(deps), gmail, hub };
}

const ctx = (agent: AgentKey, trust: Trust = 0): ToolContext => ({ workspace: WS, agent, threadId: "t-1", trust, emit: () => {} });
const tool = (tools: ToolDef[], name: string) => tools.find((t) => t.definition.name === name)!;
const run = async (tools: ToolDef[], name: string, input: Record<string, unknown>, c: ToolContext) => tool(tools, name).run(input, c);

test("app tools: Athena gets the two tools for the apps her workspace connected, reads only", async () => {
  const s = setup();
  const set = await s.source(ctx("chief"));
  assert.deepEqual(set.tools.map((t) => t.definition.name), [SEARCH_TOOL, ACTION_TOOL]);
  assert.deepEqual(set.missing, []);
  assert.equal(tool(set.tools, ACTION_TOOL).write, false);
  const schema = tool(set.tools, ACTION_TOOL).definition.input_schema as { properties: { app: { enum: string[] } } };
  assert.deepEqual(schema.properties.app.enum, ["gmail", "hubspot"], "another workspace's Slack is never offered");
  assert.match(tool(set.tools, ACTION_TOOL).definition.description!, /You can only read/);
  const apps = JSON.parse((await run(set.tools, SEARCH_TOOL, {}, ctx("chief"))).content);
  assert.deepEqual(apps.apps, [{ app: "gmail", name: "Gmail" }, { app: "hubspot", name: "HubSpot" }]);
  const list = JSON.parse((await run(set.tools, SEARCH_TOOL, { app: "Gmail" }, ctx("chief"))).content);
  assert.deepEqual(list.actions.map((a: { action: string }) => a.action), ["GMAIL_FETCH_EMAILS", "GMAIL_GET_PROFILE"], "no changes and nothing blocked for a reader");
  const one = JSON.parse((await run(set.tools, SEARCH_TOOL, { app: "gmail", action: "gmail_fetch_emails" }, ctx("chief"))).content);
  assert.deepEqual(one.inputs, { query: { type: "string", about: "A Gmail search." } });
  assert.equal((await run(set.tools, SEARCH_TOOL, { app: "gmail", action: "GMAIL_SEND_EMAIL" }, ctx("chief"))).isError, true);
  assert.equal((await run(set.tools, SEARCH_TOOL, { app: "slack" }, ctx("chief"))).isError, true);
});

test("app tools: a read runs at once on the workspace's own account; a change is refused for a reader; nothing is saved", async () => {
  const s = setup();
  const set = await s.source(ctx("chief"));
  const r = await run(set.tools, ACTION_TOOL, { app: "gmail", action: "GMAIL_FETCH_EMAILS", arguments: { query: "from:bob" } }, ctx("chief"));
  assert.equal(r.isError, undefined);
  assert.deepEqual(JSON.parse(r.content), { app: "Gmail", action: "GMAIL_FETCH_EMAILS", data: { ran: "GMAIL_FETCH_EMAILS", args: { query: "from:bob" } } });
  assert.deepEqual(s.c.ran, [{ slug: "GMAIL_FETCH_EMAILS", account: s.gmail, user: `mt_${WS_ID}`, args: { query: "from:bob" } }]);
  const w = await run(set.tools, ACTION_TOOL, { app: "gmail", action: "GMAIL_SEND_EMAIL", arguments: { recipient_email: "a@b.c", body: "Hi" } }, ctx("chief"));
  assert.deepEqual(w, { content: "You can only read from this app.", isError: true });
  assert.equal((await run(set.tools, ACTION_TOOL, { app: "gmail", action: "GMAIL_DELETE_MESSAGE" }, ctx("chief"))).content, "Deleting and cancelling stay in the app itself.");
  assert.equal((await run(set.tools, ACTION_TOOL, { app: "slack", action: "SLACK_LIST_CHANNELS" }, ctx("chief"))).isError, true);
  assert.equal((await run(set.tools, ACTION_TOOL, { app: "gmail", action: "GMAIL_NOPE" }, ctx("chief"))).isError, true);
  // A registry is for one workspace and teammate.
  assert.deepEqual(await run(set.tools, ACTION_TOOL, { app: "gmail", action: "GMAIL_FETCH_EMAILS" }, { ...ctx("chief"), workspace: { ...WS, id: OTHER_ID } }), { content: "That tool isn't available.", isError: true });
  assert.equal(s.c.ran.length, 1);
  assert.equal(s.approvals.length, 0);
});

test("app tools: nothing without the Composio key, for teammates with no apps, for apps not connected or not allowed", async () => {
  assert.deepEqual(await setup({ on: false }).source(ctx("chief")), { tools: [], missing: [] });
  for (const k of ["social", "seo"] as AgentKey[]) assert.deepEqual(await setup().source(ctx(k)), { tools: [], missing: [] }, k);
  await withSoon("sales", async () => assert.deepEqual(await setup().source(ctx("sales")), { tools: [], missing: [] }));
  assert.deepEqual(await setup({ rows: [] }).source(ctx("chief")), { tools: [], missing: [] });
  // An app that needs signing in again is said in the prompt, not offered.
  const gone = setup({ rows: [{ id: "r1", workspace_id: WS_ID, toolkit: "gmail", composio_account: "ca_x", status: "reconnect", account_label: null }] });
  assert.deepEqual(await gone.source(ctx("chief")), { tools: [], missing: [missingApp("gmail")] });
  assert.equal(missingApp("gmail"), "Gmail (it needs to be connected again in Settings, Apps)");
  // Allowed only HubSpot: Gmail isn't offered even though it's connected.
  const hubOnly = setup({ access: { sales: { toolkits: ["hubspot"], reads: false } } });
  const set = await hubOnly.source(ctx("sales"));
  assert.deepEqual((tool(set.tools, ACTION_TOOL).definition.input_schema as { properties: { app: { enum: string[] } } }).properties.app.enum, ["hubspot"]);
});

test("app tools with the real map: each teammate gets app_action only for connected apps it may use, and is told what to connect", async () => {
  // The workspace has Gmail and HubSpot (and another workspace has Slack).
  const s = setup();
  const enumOf = (tools: ToolDef[]) => (tool(tools, ACTION_TOOL).definition.input_schema as { properties: { app: { enum: string[] } } }).properties.app.enum;
  const iris = await s.source(ctx("email"));
  assert.deepEqual(enumOf(iris.tools), ["gmail"], "Iris never gets HubSpot");
  assert.equal(tool(iris.tools, ACTION_TOOL).write, true);
  assert.deepEqual(iris.missing, []);
  const hermes = await s.source(ctx("sales"));
  assert.deepEqual(enumOf(hermes.tools), ["gmail", "hubspot"]);
  assert.deepEqual(hermes.missing, ["Calendar and booking (connect Google Calendar or Calendly in Settings, Apps)"]);
  const hora = await s.source(ctx("forms"));
  assert.deepEqual(enumOf(hora.tools), ["gmail"]);
  assert.deepEqual(hora.missing, ["Calendar and booking (connect Google Calendar or Calendly in Settings, Apps)"]);
  const hestia = await s.source(ctx("support"));
  assert.deepEqual(enumOf(hestia.tools), ["gmail"], "another workspace's Slack is never offered");
  assert.deepEqual(hestia.missing, ["Team chat (connect Slack in Settings, Apps)", "Customer support (connect Zendesk or Help Scout in Settings, Apps)"]);
  // Nothing connected: no app tools, and the prompt says which apps to connect.
  const none = setup({ rows: [] });
  assert.deepEqual(await none.source(ctx("email")), { tools: [], missing: ["Email (connect Gmail or Outlook in Settings, Apps)"] });
  assert.deepEqual((await none.source(ctx("sales"))).missing, [
    "Email (connect Gmail or Outlook in Settings, Apps)",
    "Calendar and booking (connect Google Calendar or Calendly in Settings, Apps)",
    "CRM (connect HubSpot, Pipedrive or Salesforce in Settings, Apps)",
  ]);
  // A lost sign-in says connect it again, not connect another app.
  const lost = setup({ rows: [{ id: "r1", workspace_id: WS_ID, toolkit: "gmail", composio_account: "ca_x", status: "reconnect", account_label: null }] });
  assert.deepEqual(await lost.source(ctx("email")), { tools: [], missing: [missingApp("gmail")] });
  // Apps not set up on the server: one line, so the teammate does the work in chat.
  assert.deepEqual(await setup({ on: false }).source(ctx("email")), { tools: [], missing: ["Gmail or Outlook (connecting apps isn't ready yet, so do the work here in chat)"] });
  assert.deepEqual(notConnected([], [], true), []);
  for (const m of [...hermes.missing, ...hestia.missing]) assert.doesNotMatch(m, /[—–]/);
});

test("app tools with the real map: a send by Iris, a CRM change by Hermes and a reply by Hestia wait for approval", async () => {
  const s = setup();
  const send = { recipient_email: "bob@x.com", subject: "Hi", body: "Hello Bob" };
  for (const k of ["email", "forms", "sales", "support"] as AgentKey[]) {
    const set = await s.source(ctx(k));
    const r = await run(set.tools, ACTION_TOOL, { app: "gmail", action: "GMAIL_SEND_EMAIL", arguments: send }, ctx(k));
    assert.ok(r.approval, `${k}'s send waits`);
    // A read runs at once.
    assert.equal((await run(set.tools, ACTION_TOOL, { app: "gmail", action: "GMAIL_FETCH_EMAILS" }, ctx(k))).isError, undefined, k);
    // Deleting never runs, even on autopilot.
    assert.equal((await run(set.tools, ACTION_TOOL, { app: "gmail", action: "GMAIL_DELETE_MESSAGE" }, ctx(k, 2))).isError, true, k);
  }
  const hermes = await s.source(ctx("sales"));
  assert.ok((await run(hermes.tools, ACTION_TOOL, { app: "hubspot", action: "HUBSPOT_UPDATE_DEAL", arguments: { id: "9" } }, ctx("sales"))).approval);
  // Iris can't reach HubSpot even if she names it.
  const iris = await s.source(ctx("email"));
  assert.equal((await run(iris.tools, ACTION_TOOL, { app: "hubspot", action: "HUBSPOT_UPDATE_DEAL", arguments: { id: "9" } }, ctx("email"))).isError, true);
  assert.deepEqual(
    s.approvals.map((a) => [a.agent, a.product, a.tool]),
    [
      ["email", "gmail", "GMAIL_SEND_EMAIL"],
      ["forms", "gmail", "GMAIL_SEND_EMAIL"],
      ["sales", "gmail", "GMAIL_SEND_EMAIL"],
      ["support", "gmail", "GMAIL_SEND_EMAIL"],
      ["sales", "hubspot", "HUBSPOT_UPDATE_DEAL"],
    ],
  );
  // Only the reads ran.
  assert.deepEqual(s.c.ran.map((x) => x.slug), ["GMAIL_FETCH_EMAILS", "GMAIL_FETCH_EMAILS", "GMAIL_FETCH_EMAILS", "GMAIL_FETCH_EMAILS"]);
  // The approved send runs for Hermes; a HubSpot change saved by Iris (somehow) never would.
  assert.equal((await runApproval({ workspace_id: WS_ID, agent: "sales", product: "gmail", tool: "GMAIL_SEND_EMAIL", input: send }, s.deps)).ok, true);
  assert.deepEqual(await runApproval({ workspace_id: WS_ID, agent: "email", product: "hubspot", tool: "HUBSPOT_UPDATE_DEAL", input: { id: "9" } }, s.deps), { ok: false, text: "This teammate can't make this change any more." });
});

test("app tools: a change waits for approval below autopilot, with the app as the product; on autopilot it runs and is logged", async () => {
  const s = setup({ access: { sales: { toolkits: ["gmail", "hubspot"], reads: false } } });
  const set = await s.source(ctx("sales"));
  assert.equal(tool(set.tools, ACTION_TOOL).write, true);
  const missing = await run(set.tools, ACTION_TOOL, { app: "gmail", action: "GMAIL_SEND_EMAIL", arguments: { recipient_email: "bob@x.com" } }, ctx("sales"));
  assert.deepEqual(missing, { content: "Missing body. app_search_actions with this action lists the inputs.", isError: true });
  const args = { recipient_email: "bob@x.com", subject: "Your quote", body: "Hi Bob" };
  const r = await run(set.tools, ACTION_TOOL, { app: "gmail", action: "GMAIL_SEND_EMAIL", arguments: args }, ctx("sales", 1));
  assert.deepEqual(r.approval, { id: 1, title: "Send email (Gmail)" });
  assert.match(r.content, /Saved for the owner's approval as #1\. It has not run yet\./);
  assert.deepEqual(s.approvals, [{ id: 1, workspace_id: WS_ID, thread_id: "t-1", agent: "sales", product: "gmail", tool: "GMAIL_SEND_EMAIL", input: args, title: "Send email (Gmail)", why: "This changes something in your Gmail account." }]);
  assert.equal(s.c.ran.length, 0, "nothing was sent");
  assert.deepEqual(s.activity.map((a) => a.text), ['prepared "Send email (Gmail)" for your approval']);
  const auto = await run(set.tools, ACTION_TOOL, { app: "hubspot", action: "HUBSPOT_UPDATE_DEAL", arguments: { id: "9" } }, ctx("sales", 2));
  assert.equal(auto.approval, undefined);
  assert.deepEqual(s.c.ran, [{ slug: "HUBSPOT_UPDATE_DEAL", account: s.hub, user: `mt_${WS_ID}`, args: { id: "9" } }]);
  assert.equal(s.activity.at(-1)!.text, 'ran "Update deal (HubSpot)" on autopilot');
  assert.equal(s.approvals.length, 1);
});

test("app tools: a read on an account Composio says is gone marks it to connect again", async () => {
  const s = setup();
  s.c.finish(s.gmail, "EXPIRED");
  const set = await s.source(ctx("chief"));
  const r = await run(set.tools, ACTION_TOOL, { app: "gmail", action: "GMAIL_FETCH_EMAILS" }, ctx("chief"));
  assert.deepEqual(r, { content: "Connect Gmail again in Settings, Apps.", isError: true });
  assert.deepEqual(s.reconnects, [`${WS_ID}:gmail`]);
});

test("toolkitOf: the app by its slug or name", () => {
  assert.equal(toolkitOf("gmail"), "gmail");
  assert.equal(toolkitOf("Google Calendar"), "googlecalendar");
  assert.equal(toolkitOf("helpscout"), "help_scout");
  assert.equal(toolkitOf("Help Scout"), "help_scout");
  assert.equal(toolkitOf("linkedin"), null);
  assert.equal(toolkitOf(""), null);
});

// ─────────────── running an approved change ───────────────

const approved = (o: Partial<Approval> = {}) => ({ workspace_id: WS_ID, agent: "sales" as AgentKey, product: "gmail", tool: "GMAIL_SEND_EMAIL", input: { recipient_email: "bob@x.com", body: "Edited" }, ...o });

test("runApproval runs the (edited) change on the workspace's own account", async () => {
  const s = setup({ access: { sales: { toolkits: ["gmail"], reads: false } } });
  assert.equal(isAppApproval({ product: "gmail" }), true);
  assert.equal(isAppApproval({ product: "capybaroar" }), false);
  const out = await runApproval(approved(), s.deps);
  assert.equal(out.ok, true);
  assert.deepEqual(s.c.ran, [{ slug: "GMAIL_SEND_EMAIL", account: s.gmail, user: `mt_${WS_ID}`, args: { recipient_email: "bob@x.com", body: "Edited" } }]);
});

test("runApproval checks again: a disconnected app, a lost sign-in, a teammate no longer allowed, no key, an action now blocked", async () => {
  const s = setup({ access: { sales: { toolkits: ["gmail"], reads: false } } });
  const disconnected = setup({ rows: [], access: { sales: { toolkits: ["gmail"], reads: false } } });
  assert.deepEqual(await runApproval(approved(), disconnected.deps), { ok: false, text: "Gmail isn't connected any more. Connect it in Settings, Apps, then ask again." });
  const lost = setup({ rows: [{ id: "r1", workspace_id: WS_ID, toolkit: "gmail", composio_account: "ca_1", status: "reconnect", account_label: null }], access: { sales: { toolkits: ["gmail"], reads: false } } });
  assert.deepEqual(await runApproval(approved(), lost.deps), { ok: false, text: "Connect Gmail again in Settings, Apps, then ask again." });
  // Only another workspace has Gmail: never used for this one.
  const theirs = setup({ rows: [{ id: "r9", workspace_id: OTHER_ID, toolkit: "gmail", composio_account: "ca_9", status: "active", account_label: null }], access: { sales: { toolkits: ["gmail"], reads: false } } });
  assert.equal((await runApproval(approved(), theirs.deps)).ok, false);
  assert.deepEqual(await runApproval(approved({ agent: "chief" }), setup().deps), { ok: false, text: "This teammate can't make this change any more." });
  assert.deepEqual(await runApproval(approved({ agent: "social" }), setup().deps), { ok: false, text: "This teammate can't make this change any more." }, "the real map gives Aphrodite no apps");
  await withSoon("sales", async () => assert.deepEqual(await runApproval(approved(), setup().deps), { ok: false, text: "This teammate can't make this change any more." }, "a coming soon teammate"));
  assert.deepEqual(await runApproval(approved(), { ...s.deps, on: false }), { ok: false, text: "Apps aren't set up on the server yet." });
  assert.deepEqual(await runApproval(approved({ tool: "GMAIL_DELETE_MESSAGE" }), s.deps), { ok: false, text: "This change isn't allowed." });
  assert.deepEqual(await runApproval(approved({ tool: "GMAIL_FETCH_EMAILS" }), s.deps), { ok: false, text: "This change isn't allowed." });
  assert.deepEqual(await runApproval(approved({ tool: "GMAIL_GONE" }), s.deps), { ok: false, text: "This action isn't available any more." });
  assert.deepEqual(await runApproval(approved({ product: "linkedin" }), s.deps), { ok: false, text: "This kind of change isn't supported." });
  s.c.finish(s.gmail, "EXPIRED");
  assert.deepEqual(await runApproval(approved(), s.deps), { ok: false, text: "Connect Gmail again in Settings, Apps." });
  assert.deepEqual(s.reconnects, [`${WS_ID}:gmail`]);
  assert.equal(s.c.ran.length, 0);
});

// ─────────────── closing a workspace ───────────────

test("closeApps removes every account of the workspace at Composio and here, and never another workspace's", async () => {
  const c = fakeComposio();
  const db = fakeDb();
  const a = c.addAccount(composioUser(WS_ID), "gmail");
  const b = c.addAccount(composioUser(WS_ID), "slack");
  const keep = c.addAccount(composioUser(OTHER_ID), "gmail");
  db.tables.app_connections = [
    { id: "1", workspace_id: WS_ID, toolkit: "gmail", composio_account: a, status: "active", created_at: "1" },
    { id: "2", workspace_id: WS_ID, toolkit: "slack", composio_account: b, status: "reconnect", created_at: "2" },
    { id: "3", workspace_id: OTHER_ID, toolkit: "gmail", composio_account: keep, status: "active", created_at: "3" },
  ];
  const logs: string[] = [];
  assert.equal(await closeApps(db as never, WS_ID, { fetcher: c.fetch, env: ENV, log: (m) => logs.push(m) }), 2);
  assert.deepEqual(c.deleted, [a, b]);
  assert.deepEqual(db.tables.app_connections.map((r) => r.id), ["3"]);
  // Composio down: the rows still go, and it's logged.
  db.tables.app_connections.push({ id: "4", workspace_id: WS_ID, toolkit: "gmail", composio_account: "ca_404", status: "active", created_at: "4" });
  assert.equal(await closeApps(db as never, WS_ID, { fetcher: c.fetch, env: {}, log: (m) => logs.push(m) }), 0);
  assert.deepEqual(db.tables.app_connections.map((r) => r.id), ["3"]);
  assert.match(logs.join("\n"), /wasn't removed at close/);
  assert.equal(await closeApps(db as never, WS_ID, { fetcher: c.fetch, env: ENV }), 0);
});

// ─────────────── the website builders (Hephaestus) ───────────────

type FixtureTool = { slug: string; name: string; tags: string[]; input_parameters: Record<string, unknown> };
const BUILDERS = JSON.parse(readFileSync(new URL("./fixtures/composio-builders.json", import.meta.url), "utf8")) as Record<"framer" | "webflow" | "wordpress_com" | "shopify", FixtureTool[]>;
const LISTS = { framer: FRAMER_ACTIONS, webflow: WEBFLOW_ACTIONS, wordpress_com: WORDPRESS_COM_ACTIONS, shopify: SHOPIFY_ACTIONS } as const;
const sortReal = (toolkit: keyof typeof LISTS) => BUILDERS[toolkit].map((t) => [t.slug, kindOf(toolkit, { ...t, description: "" }).kind] as const);

test("website builders: Hephaestus gets the listed actions only, each real on Composio; reads read, changes wait, nothing deletes", () => {
  for (const toolkit of ["framer", "webflow", "wordpress_com", "shopify"] as const) {
    const list = LISTS[toolkit];
    assert.equal(TOOLKITS[toolkit].actions, list);
    const real = new Set(BUILDERS[toolkit].map((t) => t.slug));
    for (const slug of Object.keys(list)) assert.ok(real.has(slug), `${slug} is one of Composio's ${toolkit} actions`);
    // Every one of Composio's actions sorted: the listed ones as listed, every other one blocked.
    for (const [slug, kind] of sortReal(toolkit)) assert.equal(kind, list[slug]?.kind ?? "blocked", slug);
    // Every change has an approval title in plain words, and no listed action deletes.
    for (const [slug, a] of Object.entries(list)) {
      assert.doesNotMatch(slug, /DELETE|REMOVE|REFUND|CANCEL|ARCHIVE/, slug);
      if (a.kind === "write") {
        assert.match(a.title, /^[A-Z][a-z]/, slug);
        assert.doesNotMatch(a.title, /[–—]|_/, slug);
        assert.ok(a.title.length <= 60, slug);
      }
    }
  }
  const writes = (l: Record<string, { kind: string }>) => Object.keys(l).filter((k) => l[k].kind === "write");
  assert.deepEqual(writes(FRAMER_ACTIONS), ["FRAMER_CREATE_WEB_PAGE", "FRAMER_CLONE_WEB_PAGE", "FRAMER_APPLY_AGENT_CHANGES", "FRAMER_REPLACE_TEXT_FOR_AGENT", "FRAMER_ADD_COLLECTION_ITEMS", "FRAMER_PUBLISH", "FRAMER_DEPLOY"]);
  assert.deepEqual(writes(WEBFLOW_ACTIONS), ["WEBFLOW_CREATE_COLLECTION_ITEM", "WEBFLOW_UPDATE_COLLECTION_ITEM_V2", "WEBFLOW_UPDATE_PAGE_METADATA", "WEBFLOW_PUBLISH_SITE"]);
  assert.deepEqual(writes(WORDPRESS_COM_ACTIONS), ["WORDPRESS_COM_CREATE_DRAFT_POST", "WORDPRESS_COM_UPDATE_DRAFT_POST"]);
  assert.equal(changeTitle("framer", "FRAMER_DEPLOY", "Deploy"), "Publish your Framer site");
  assert.equal(changeTitle("framer", "FRAMER_PUBLISH", "Publish"), "Make a preview of your Framer site");
  assert.equal(changeTitle("webflow", "WEBFLOW_CREATE_COLLECTION_ITEM", "Create collection item"), "Add a blog post or CMS item to Webflow");
  assert.equal(changeTitle("webflow", "WEBFLOW_PUBLISH_SITE", "Publish site"), "Publish your Webflow site");
  assert.equal(changeTitle("wordpress_com", "WORDPRESS_COM_CREATE_DRAFT_POST", "Create draft post"), "Add a draft post to WordPress.com");
  // Apps without a list keep their old title.
  assert.equal(changeTitle("gmail", "GMAIL_SEND_EMAIL", "Send email"), "Send email (Gmail)");
  assert.equal(appAction("gmail", "GMAIL_SEND_EMAIL"), undefined);
  assert.equal(appAction("framer", "constructor"), undefined);
});

test("website builders: a listed publish is a change even though Composio hints it is destructive; deleting and unlisted actions never run", () => {
  const k = (toolkit: string, slug: string, tags: string[] = []) => kindOf(toolkit, { slug, name: slug, description: "", tags });
  // Framer marks publishing destructive. Listed, it is a change that waits for the owner.
  assert.deepEqual(k("framer", "FRAMER_PUBLISH", ["updateHint", "destructiveHint"]), { kind: "write" });
  assert.deepEqual(k("framer", "FRAMER_DEPLOY", ["destructiveHint"]), { kind: "write" });
  // Deleting is blocked even when Composio calls it something else.
  assert.equal(k("framer", "FRAMER_REMOVE_NODES", ["destructiveHint"]).kind, "blocked");
  assert.equal(k("webflow", "WEBFLOW_DELETE_COLLECTION_ITEM").kind, "blocked");
  assert.equal(k("wordpress_com", "WORDPRESS_COM_DELETE_DRAFT_POST").kind, "blocked");
  // Not on the list: blocked, read or not.
  assert.deepEqual(k("framer", "FRAMER_GET_CODE_FILES", ["readOnlyHint"]), { kind: "blocked", why: "Your team doesn't run that action." });
  assert.equal(k("framer", "FRAMER_SET_CUSTOM_CODE").kind, "blocked");
  assert.equal(k("webflow", "WEBFLOW_REFUND_ORDER").kind, "blocked");
  assert.equal(k("webflow", "WEBFLOW_LIST_ORDERS", ["readOnlyHint"]).kind, "blocked");
  // Composio has more Webflow and WordPress.com actions than the team uses; ones that publish or delete stay out.
  for (const slug of ["WEBFLOW_UPDATE_LIVE_COLLECTION_ITEM", "WEBFLOW_CREATE_LIVE_COLLECTION_ITEM", "WEBFLOW_PUBLISH_COLLECTION_ITEMS", "WEBFLOW_UPDATE_SITE"]) assert.equal(k("webflow", slug).kind, "blocked", slug);
  for (const slug of ["WORDPRESS_COM_UPDATE_POST", "WORDPRESS_COM_CREATE_PAGE", "WORDPRESS_COM_UPDATE_SITE_SETTINGS", "WORDPRESS_COM_DELETE_POST"]) assert.equal(k("wordpress_com", slug).kind, "blocked", slug);
  // A listed read is a read.
  assert.deepEqual(k("framer", "FRAMER_GET_AGENT_CONTEXT", ["readOnlyHint"]), { kind: "read" });
  assert.deepEqual(k("wordpress_com", "WORDPRESS_COM_LIST_CONTENT"), { kind: "read" });
});

function builderSetup(o: { rows?: string[]; direct?: string[] } = {}) {
  forgetTools();
  const c = fakeComposio({ tools: { framer: BUILDERS.framer, webflow: BUILDERS.webflow, wordpress_com: BUILDERS.wordpress_com, shopify: BUILDERS.shopify, gmail: [] } });
  const user = composioUser(WS_ID);
  const accounts: Record<string, string> = {};
  const rows: ConnRow[] = (o.rows ?? ["framer", "webflow", "wordpress_com"]).map((toolkit, i) => {
    accounts[toolkit] = c.addAccount(user, toolkit);
    return { id: `b${i}`, workspace_id: WS_ID, toolkit, composio_account: accounts[toolkit], status: "active", account_label: null, connected_by: "u1", created_at: "2026-11-18" };
  });
  const approvals: (NewApproval & { id: number })[] = [];
  const activity: ActivityRow[] = [];
  const deps: AppToolDeps = {
    on: true,
    connections: async (ws) => rows.filter((r) => r.workspace_id === ws),
    saveApproval: async (a) => {
      approvals.push({ ...a, id: approvals.length + 1 });
      return { id: approvals.length };
    },
    activity: async (r) => void activity.push(r),
    markReconnect: async () => {},
    net: { fetcher: c.fetch, env: ENV, sleep: noWait },
    ...(o.direct ? { direct: async () => o.direct! } : {}),
  };
  return { c, deps, approvals, activity, accounts, source: appToolSource(deps) };
}

test("Hephaestus: app tools for Framer, Webflow and WordPress.com; reads run at once, every change waits with a clear title", async () => {
  const s = builderSetup();
  const set = await s.source(ctx("web"));
  assert.deepEqual((tool(set.tools, ACTION_TOOL).definition.input_schema as { properties: { app: { enum: string[] } } }).properties.app.enum, ["framer", "webflow", "wordpress_com"]);
  assert.equal(tool(set.tools, ACTION_TOOL).write, true);
  assert.deepEqual(set.missing, []);
  // He sees only the listed actions.
  const list = JSON.parse((await run(set.tools, SEARCH_TOOL, { app: "Framer" }, ctx("web"))).content);
  assert.deepEqual(list.actions.map((a: { action: string }) => a.action).sort(), Object.keys(FRAMER_ACTIONS).sort());
  const wp = JSON.parse((await run(set.tools, SEARCH_TOOL, { app: "WordPress.com" }, ctx("web"))).content);
  assert.deepEqual(wp.actions.map((a: { action: string }) => a.action).sort(), Object.keys(WORDPRESS_COM_ACTIONS).sort());
  // A read runs at once.
  const r = await run(set.tools, ACTION_TOOL, { app: "framer", action: "FRAMER_GET_UNPUBLISHED_PAGE_CHANGES" }, ctx("web"));
  assert.equal(r.isError, undefined);
  assert.deepEqual(s.c.ran.map((x) => [x.slug, x.account]), [["FRAMER_GET_UNPUBLISHED_PAGE_CHANGES", s.accounts.framer]]);
  // Every change waits for the owner, even ones Composio calls destructive, under the catalog's title.
  const asks: [string, string, Record<string, unknown>][] = [
    ["framer", "FRAMER_CREATE_WEB_PAGE", { page_path: "/roof-repair" }],
    ["framer", "FRAMER_APPLY_AGENT_CHANGES", { dsl: "add hero", page_path: "/roof-repair" }],
    ["framer", "FRAMER_PUBLISH", {}],
    ["framer", "FRAMER_DEPLOY", { deployment_id: "d1" }],
    ["webflow", "WEBFLOW_CREATE_COLLECTION_ITEM", { collection_id: "c1", field_data: { name: "Spring tips", slug: "spring-tips" }, is_draft: true }],
    ["webflow", "WEBFLOW_PUBLISH_SITE", { site_id: "s1" }],
    ["wordpress_com", "WORDPRESS_COM_CREATE_DRAFT_POST", { site: "1", title: "Spring tips" }],
  ];
  for (const [app, action, args] of asks) {
    const missing = BUILDERS[app as keyof typeof BUILDERS].find((t) => t.slug === action)!.input_parameters.required as string[];
    const filled = Object.fromEntries(missing.map((k) => [k, args[k] ?? "x"]));
    const out = await run(set.tools, ACTION_TOOL, { app, action, arguments: { ...filled, ...args } }, ctx("web", 1));
    assert.ok(out.approval, `${action} waits`);
  }
  assert.deepEqual(
    s.approvals.map((a) => [a.agent, a.product, a.title]),
    [
      ["web", "framer", "Add a page to your Framer site"],
      ["web", "framer", "Change a page on your Framer site"],
      ["web", "framer", "Make a preview of your Framer site"],
      ["web", "framer", "Publish your Framer site"],
      ["web", "webflow", "Add a blog post or CMS item to Webflow"],
      ["web", "webflow", "Publish your Webflow site"],
      ["web", "wordpress_com", "Add a draft post to WordPress.com"],
    ],
  );
  assert.equal(s.approvals[3].why, "This changes something in your Framer account.");
  assert.equal(s.c.ran.length, 1, "nothing changed on the site");
  // Deleting and unlisted actions never run, even on autopilot.
  for (const [app, action] of [["framer", "FRAMER_REMOVE_NODES"], ["framer", "FRAMER_SET_CUSTOM_CODE"], ["webflow", "WEBFLOW_DELETE_COLLECTION_ITEM"], ["wordpress_com", "WORDPRESS_COM_DELETE_DRAFT_POST"]]) {
    assert.equal((await run(set.tools, ACTION_TOOL, { app, action, arguments: { id: "1" } }, ctx("web", 2))).isError, true, action);
  }
  // On autopilot a publish runs, and is logged.
  await run(set.tools, ACTION_TOOL, { app: "webflow", action: "WEBFLOW_PUBLISH_SITE", arguments: { site_id: "s1" } }, ctx("web", 2));
  assert.deepEqual(s.c.ran.at(-1), { slug: "WEBFLOW_PUBLISH_SITE", account: s.accounts.webflow, user: `mt_${WS_ID}`, args: { site_id: "s1" } });
  assert.equal(s.activity.at(-1)!.text, 'ran "Publish your Webflow site" on autopilot');
});

test("Hephaestus: told which site builder to connect when none is; others can't reach his builders; approved publishes are checked again", async () => {
  const none = builderSetup({ rows: [] });
  assert.deepEqual(await none.source(ctx("web")), { tools: [], missing: ["Website (connect Framer, Webflow, WordPress.com, Shopify or WordPress in Settings, Apps)"] });
  // His own WordPress site counts as a site builder: nothing to connect.
  assert.deepEqual(await builderSetup({ rows: [], direct: ["wordpress"] }).source(ctx("web")), { tools: [], missing: [] });
  assert.deepEqual(await builderSetup().source({ ...ctx("social") }), { tools: [], missing: [] });
  // Iris can't use Framer, even when it's connected.
  const s = builderSetup();
  assert.deepEqual(await s.source(ctx("email")), { tools: [], missing: ["Email (connect Gmail or Outlook in Settings, Apps)"] });
  // Athena only reads the builders.
  const chief = await s.source(ctx("chief"));
  assert.equal((await run(chief.tools, ACTION_TOOL, { app: "framer", action: "FRAMER_DEPLOY", arguments: { deployment_id: "d1" } }, ctx("chief", 2))).content, "You can only read from this app.");
  // The approved publish runs on the workspace's own Framer account; a delete saved somehow never would.
  const ok = await runApproval({ workspace_id: WS_ID, agent: "web", product: "framer", tool: "FRAMER_DEPLOY", input: { deployment_id: "d1" } }, s.deps);
  assert.equal(ok.ok, true);
  assert.deepEqual(s.c.ran.at(-1), { slug: "FRAMER_DEPLOY", account: s.accounts.framer, user: `mt_${WS_ID}`, args: { deployment_id: "d1" } });
  assert.deepEqual(await runApproval({ workspace_id: WS_ID, agent: "web", product: "framer", tool: "FRAMER_REMOVE_NODES", input: {} }, s.deps), { ok: false, text: "This change isn't allowed." });
  assert.deepEqual(await runApproval({ workspace_id: WS_ID, agent: "email", product: "framer", tool: "FRAMER_DEPLOY", input: {} }, s.deps), { ok: false, text: "This teammate can't make this change any more." });
});

test("Hephaestus: Framer's guide to its own commands comes back longer than other answers before it is cut", async () => {
  const s = builderSetup({ rows: ["framer"] });
  const set = await s.source(ctx("web"));
  const big = "x".repeat(20_000);
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (/execute\/FRAMER_/.test(url)) return new Response(JSON.stringify({ successful: true, data: big }), { status: 200 });
    return s.c.fetch(input, init);
  }) as typeof fetch;
  s.deps.net = { ...s.deps.net, fetcher };
  const guide = JSON.parse((await run(set.tools, ACTION_TOOL, { app: "framer", action: "FRAMER_GET_AGENT_SYSTEM_PROMPT" }, ctx("web"))).content);
  const info = JSON.parse((await run(set.tools, ACTION_TOOL, { app: "framer", action: "FRAMER_GET_PROJECT_INFO" }, ctx("web"))).content);
  assert.ok(guide.data.length > 13_000 && guide.data.length < 15_000, String(guide.data.length));
  assert.ok(info.data.length < 8_100, String(info.data.length));
  assert.match(guide.data, /cut short/);
});

// ─────────────── Shopify (through Composio) and the apps Morning Telos connects itself ───────────────

test("Shopify: only pages and blog posts, each listed action real on Composio; products, orders, customers, discounts, payments and deletes stay blocked", () => {
  const writes = Object.keys(SHOPIFY_ACTIONS).filter((k) => SHOPIFY_ACTIONS[k].kind === "write");
  assert.deepEqual(writes, ["SHOPIFY_CREATE_PAGE", "SHOPIFY_UPDATE_PAGE", "SHOPIFY_CREATE_ARTICLE", "SHOPIFY_UPDATE_ARTICLE"]);
  assert.deepEqual(Object.keys(SHOPIFY_ACTIONS).filter((k) => SHOPIFY_ACTIONS[k].kind === "read"), ["SHOPIFY_GET_SHOP_INFO", "SHOPIFY_LIST_PAGES", "SHOPIFY_GET_PAGE_BY_ID", "SHOPIFY_LIST_BLOGS", "SHOPIFY_LIST_BLOG_ARTICLES", "SHOPIFY_GET_ARTICLE"]);
  for (const slug of Object.keys(SHOPIFY_ACTIONS)) assert.doesNotMatch(slug, /PRODUCT|ORDER|CUSTOMER|DISCOUNT|REFUND|PAYMENT|PRICE|GIFT|INVENTORY|FULFILL|THEME|DELETE/, slug);
  const sorted = new Map(sortReal("shopify"));
  // The real list has hundreds of store actions: every one not listed is blocked.
  assert.ok(BUILDERS.shopify.length > 300, String(BUILDERS.shopify.length));
  for (const t of BUILDERS.shopify) if (/PRODUCT|ORDER|CUSTOMER|DISCOUNT|REFUND|PAYMENT|DELETE|THEME|METAFIELD|REDIRECT/.test(t.slug)) assert.equal(sorted.get(t.slug), "blocked", t.slug);
  for (const slug of ["SHOPIFY_DELETE_PAGE", "SHOPIFY_DELETE_ARTICLE", "SHOPIFY_CREATE_BLOG", "SHOPIFY_GRAPH_QL_SHOP", "SHOPIFY_CREATE_REDIRECT"]) assert.equal(sorted.get(slug), "blocked", slug);
  // Approval titles in plain words; an update that puts it live says so.
  assert.equal(changeTitle("shopify", "SHOPIFY_CREATE_PAGE", "Create a new page"), "Add a hidden page to Shopify");
  assert.equal(changeTitle("shopify", "SHOPIFY_UPDATE_PAGE", "Update Page", { page_id: "1", body_html: "<p>x</p>" }), "Update a page on Shopify");
  assert.equal(changeTitle("shopify", "SHOPIFY_UPDATE_PAGE", "Update Page", { page_id: "1", published: true }), "Publish a page on Shopify");
  assert.equal(changeTitle("shopify", "SHOPIFY_UPDATE_ARTICLE", "Update Article", { blog_id: "1", article_id: "2", published_at: "2026-12-01T09:00:00Z" }), "Publish a blog post on Shopify");
  assert.equal(changeTitle("shopify", "SHOPIFY_CREATE_ARTICLE", "Create Article", { published: true }), "Add a hidden blog post to Shopify", "a create has no publish title");
  assert.equal(publishes({ published: false }), false);
  assert.equal(publishes({ published_at: " " }), false);
});

test("appArgs: a new Shopify page or post is always made unpublished; other actions keep their inputs", () => {
  assert.deepEqual(appArgs("shopify", "SHOPIFY_CREATE_PAGE", { title: "Roof repair", body_html: "<p>Hi</p>", published: true, published_at: "2026-11-18T00:00:00Z" }), { title: "Roof repair", body_html: "<p>Hi</p>", published: false });
  assert.deepEqual(appArgs("shopify", "SHOPIFY_CREATE_ARTICLE", { blog_id: "7", title: "Tips" }), { blog_id: "7", title: "Tips", published: false });
  const upd = { page_id: "1", published: true };
  assert.equal(appArgs("shopify", "SHOPIFY_UPDATE_PAGE", upd), upd);
  assert.deepEqual(appArgs("webflow", "WEBFLOW_PUBLISH_SITE", { site_id: "s1" }), { site_id: "s1" });
  assert.deepEqual(appArgs("gmail", "GMAIL_SEND_EMAIL", { body: "x" }), { body: "x" });
});

test("Hephaestus on Shopify: reads run at once; a new page waits and is saved unpublished; publishing waits under its own title and is checked again", async () => {
  const s = builderSetup({ rows: ["shopify"] });
  const set = await s.source(ctx("web"));
  const listed = JSON.parse((await run(set.tools, SEARCH_TOOL, { app: "Shopify" }, ctx("web"))).content);
  assert.deepEqual(listed.actions.map((a: { action: string }) => a.action).sort(), Object.keys(SHOPIFY_ACTIONS).sort());
  assert.equal((await run(set.tools, ACTION_TOOL, { app: "shopify", action: "SHOPIFY_LIST_PAGES" }, ctx("web"))).isError, undefined);
  assert.deepEqual(s.c.ran.map((x) => x.slug), ["SHOPIFY_LIST_PAGES"]);
  // The model asks for a live page: it is saved for approval as a hidden one.
  const made = await run(set.tools, ACTION_TOOL, { app: "shopify", action: "SHOPIFY_CREATE_PAGE", arguments: { title: "Roof repair", body_html: "<h1>Roof repair</h1>", published: true } }, ctx("web"));
  assert.ok(made.approval);
  assert.deepEqual([s.approvals[0].title, s.approvals[0].input], ["Add a hidden page to Shopify", { title: "Roof repair", body_html: "<h1>Roof repair</h1>", published: false }]);
  const pub = await run(set.tools, ACTION_TOOL, { app: "shopify", action: "SHOPIFY_UPDATE_PAGE", arguments: { page_id: "42", published: true } }, ctx("web"));
  assert.ok(pub.approval);
  assert.equal(s.approvals[1].title, "Publish a page on Shopify");
  assert.equal(s.c.ran.length, 1, "nothing changed in the store yet");
  // Even on autopilot a new post goes in hidden.
  await run(set.tools, ACTION_TOOL, { app: "shopify", action: "SHOPIFY_CREATE_ARTICLE", arguments: { blog_id: "7", title: "Spring tips", published: true } }, ctx("web", 2));
  assert.deepEqual(s.c.ran.at(-1)!.args, { blog_id: "7", title: "Spring tips", published: false });
  // An approval edited to publish a new page still runs it hidden.
  const ok = await runApproval({ workspace_id: WS_ID, agent: "web", product: "shopify", tool: "SHOPIFY_CREATE_PAGE", input: { title: "Roof repair", published: true } }, s.deps);
  assert.equal(ok.ok, true);
  assert.deepEqual(s.c.ran.at(-1), { slug: "SHOPIFY_CREATE_PAGE", account: s.accounts.shopify, user: `mt_${WS_ID}`, args: { title: "Roof repair", published: false } });
  // The approved publish runs as asked; a delete or a product change never would.
  assert.equal((await runApproval({ workspace_id: WS_ID, agent: "web", product: "shopify", tool: "SHOPIFY_UPDATE_PAGE", input: { page_id: "42", published: true } }, s.deps)).ok, true);
  assert.deepEqual(s.c.ran.at(-1)!.args, { page_id: "42", published: true });
  for (const tool of ["SHOPIFY_DELETE_PAGE", "SHOPIFY_CREATE_PRODUCT", "SHOPIFY_CREATE_ORDER"]) {
    assert.equal((await runApproval({ workspace_id: WS_ID, agent: "web", product: "shopify", tool, input: {} }, s.deps)).ok, false, tool);
  }
  // Only Hephaestus changes things on Shopify; Athena only reads.
  assert.deepEqual(await runApproval({ workspace_id: WS_ID, agent: "chief", product: "shopify", tool: "SHOPIFY_UPDATE_PAGE", input: { page_id: "42" } }, s.deps), { ok: false, text: "This teammate can't make this change any more." });
});

test("direct apps: WordPress is Morning Telos's own connection, in the Website group, for Hephaestus, never a Composio toolkit", () => {
  assert.deepEqual(DIRECT_APPS.map((a) => [a.id, a.name, a.group, a.forAgents]), [["wordpress", "WordPress", "website", ["web"]]]);
  assert.doesNotMatch(DIRECT.wordpress.blurb, /[–—]/);
  assert.equal(isToolkit("wordpress"), false);
  assert.equal(isAppId("wordpress"), true);
  assert.equal(isAppId("shopify"), true);
  assert.equal(isAppId("constructor"), false);
  assert.equal(appName("wordpress"), "WordPress");
  assert.equal(appName("wordpress_com"), "WordPress.com");
  assert.equal(groupOf("wordpress"), "website");
  assert.equal(groupOf("gmail"), "mail");
  assert.equal(groupOf("nope"), undefined);
  assert.equal(toolkitOf("WordPress"), null, "WordPress isn't run through app_action");
  assert.equal(changesApps("web"), true);
});

test("notConnected with a direct app: it counts for its group and connects without Composio", () => {
  const kits = ["framer", "shopify"];
  assert.deepEqual(notConnected(kits, [], true, ["wordpress"]), ["Website (connect Framer, Shopify or WordPress in Settings, Apps)"]);
  assert.deepEqual(notConnected(kits, ["wordpress"], true, ["wordpress"]), []);
  assert.deepEqual(notConnected(kits, ["shopify"], true, ["wordpress"]), []);
  // Composio off: the Composio apps can't connect, but WordPress still can.
  assert.deepEqual(notConnected(kits, [], false, ["wordpress"]), ["Framer or Shopify (connecting apps isn't ready yet, so do the work here in chat)", "Website (connect WordPress in Settings, Apps)"]);
  assert.deepEqual(notConnected(kits, ["wordpress"], false, ["wordpress"]), []);
  assert.deepEqual(notConnected([], [], true, ["wordpress"]), ["Website (connect WordPress in Settings, Apps)"]);
  // Before: unchanged without direct apps.
  assert.deepEqual(notConnected(["gmail"], [], false), ["Gmail (connecting apps isn't ready yet, so do the work here in chat)"]);
});

test("Hephaestus with Composio off but WordPress connected: no line telling him to connect a site builder", async () => {
  const s = builderSetup({ rows: [], direct: ["wordpress"] });
  s.deps.on = false;
  assert.deepEqual(await appToolSource(s.deps)(ctx("web")), { tools: [], missing: [] });
  const none = builderSetup({ rows: [], direct: [] });
  none.deps.on = false;
  assert.deepEqual((await appToolSource(none.deps)(ctx("web"))).missing, [
    "Framer, Webflow, WordPress.com or Shopify (connecting apps isn't ready yet, so do the work here in chat)",
    "Website (connect WordPress in Settings, Apps)",
  ]);
  // A direct app list that fails is read as none, and never stops the app tools.
  const broken = builderSetup({ rows: ["framer"] });
  broken.deps.direct = async () => {
    throw new Error("db down");
  };
  assert.equal((await appToolSource(broken.deps)(ctx("web"))).tools.length, 2);
});
