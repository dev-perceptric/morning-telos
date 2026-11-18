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
import { access, ACTION_TOOL, appToolSource, isAppApproval, missingApp, runApproval, SEARCH_TOOL, toolkitOf, type AppToolDeps } from "../src/lib/composio/appAction.ts";
import { APP_ACCESS, APPS, appsFor, TOOLKITS } from "../src/lib/composio/catalog.ts";
import { composioOn, composioUser, connectable } from "../src/lib/composio/composio.ts";
import { accountLabel, activeAccount, authConfigFor, connectLink, dropAccount, forgetConfigs, readState, signState, STATE_TTL_MS } from "../src/lib/composio/connect.ts";
import { closeApps, type ConnRow } from "../src/lib/composio/store.ts";
import type { ActivityRow } from "../src/lib/productTools.ts";
import type { Keyring } from "../src/lib/sealing.ts";
import { AGENTS, ORDER, type AgentKey } from "../src/lib/team.ts";
import { BASE, fakeComposio, KEY } from "./fakeComposio.ts";
import { fakeDb } from "./server/fakeDb.ts";

const ENV = { COMPOSIO_API_KEY: KEY, COMPOSIO_BASE_URL: BASE };
const WS_ID = "11111111-2222-4333-8444-555555555555";
const OTHER_ID = "11111111-2222-4333-8444-666666666666";
const WS: TeamWorkspace = { id: WS_ID, name: "Ana's Bakery", website: "anasbakery.com", plan: "trial", status: "trialing", trial_ends_at: new Date(Date.now() + 864e6).toISOString(), period_start: new Date().toISOString() };
const ring = (): Keyring => ({ current: "t1", keys: new Map([["t1", randomBytes(32)]]) });
const noWait = async () => {};

// ─────────────── the catalog ───────────────

test("catalog: the ten apps the team needs, with their Composio slugs, and the SQL check lists the same ones", () => {
  assert.deepEqual(
    APPS.map((a) => a.toolkit),
    ["gmail", "outlook", "googlecalendar", "calendly", "hubspot", "pipedrive", "salesforce", "slack", "zendesk", "help_scout"],
  );
  for (const a of APPS) {
    assert.ok(a.name && a.blurb && a.forAgents.length, a.toolkit);
    assert.doesNotMatch(a.blurb, /[–—]/);
    for (const k of a.forAgents) assert.ok(ORDER.includes(k), `${a.toolkit}: ${k}`);
  }
  // Composio has no app of its own for these two, so they need our own auth config.
  assert.deepEqual(APPS.filter((a) => !a.managed).map((a) => a.toolkit), ["pipedrive", "help_scout"]);
  const sql = readFileSync(new URL("../supabase/016_app_connections.sql", import.meta.url), "utf8");
  const listed = sql.match(/toolkit in \(([^)]+)\)/)![1].split(",").map((s) => s.trim().replace(/'/g, ""));
  assert.deepEqual(listed.sort(), Object.keys(TOOLKITS).sort());
});

test("catalog: each app's own auth config can be set in .env.example (and so in web-compose.yml)", () => {
  const example = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
  for (const k of ["COMPOSIO_API_KEY", "COMPOSIO_BASE_URL", ...APPS.map((a) => `COMPOSIO_AUTH_CONFIG_${a.toolkit.toUpperCase()}`)]) assert.match(example, new RegExp(`^${k}=$`, "m"), k);
});

test("access: only Athena may use apps for now, and only to read; coming soon teammates get nothing", () => {
  assert.deepEqual(Object.keys(APP_ACCESS), ["chief"]);
  assert.deepEqual(access("chief"), { toolkits: APPS.map((a) => a.toolkit), reads: true });
  for (const k of ORDER.filter((k) => k !== "chief")) assert.deepEqual(access(k).toolkits, [], k);
  // A teammate given apps while still coming soon gets nothing (P4.2 drops soon and sets APP_ACCESS together).
  assert.deepEqual(appsFor("sales", true), { toolkits: [], reads: true });
  assert.equal(AGENTS.chief.readOnly, true);
});

test("connectable: needs the server key; Pipedrive and Help Scout also need our own auth config", () => {
  assert.equal(composioOn({}), false);
  assert.equal(connectable(TOOLKITS.gmail, {}), false);
  assert.equal(connectable(TOOLKITS.gmail, ENV), true);
  assert.equal(connectable(TOOLKITS.pipedrive, ENV), false);
  assert.equal(connectable(TOOLKITS.pipedrive, { ...ENV, COMPOSIO_AUTH_CONFIG_PIPEDRIVE: "ac_pd" }), true);
  assert.equal(connectable(TOOLKITS.help_scout, { ...ENV, COMPOSIO_AUTH_CONFIG_HELP_SCOUT: " ac_hs " }), true);
  assert.equal(connectable(undefined, ENV), false);
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

test("app tools: nothing without the Composio key, for coming soon teammates, for apps not connected or not allowed", async () => {
  assert.deepEqual(await setup({ on: false }).source(ctx("chief")), { tools: [], missing: [] });
  for (const k of ["sales", "support", "forms", "email", "social", "seo", "web"] as AgentKey[]) assert.deepEqual(await setup().source(ctx(k)), { tools: [], missing: [] }, k);
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
  assert.deepEqual(await runApproval(approved(), setup().deps), { ok: false, text: "This teammate can't make this change any more." }, "the real map gives sales nothing yet");
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
