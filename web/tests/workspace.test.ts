// Roles, invite links, the delete check, settings and page routes. Pure functions, no network.
import assert from "node:assert/strict";
import test from "node:test";
import { parseRoute, routePath } from "../src/lib/routes.ts";
import {
  ASSIGNABLE,
  atLeast,
  can,
  cleanSettings,
  deleteConfirmMatches,
  inviteLink,
  inviteTokenFromPath,
  memberActions,
  NEEDS,
  type Action,
  type Role,
} from "../src/lib/workspace.ts";
import { goodbyeMail, inviteMail, sendMail } from "../src/lib/workspaceMail.ts";

const ROLES: Role[] = ["owner", "admin", "editor", "viewer"];

test("which roles can do which workspace action", () => {
  const expected: Record<Action, Role[]> = {
    viewSettings: ["owner", "admin", "editor", "viewer"],
    editSettings: ["owner", "admin"],
    viewMembers: ["owner", "admin", "editor", "viewer"],
    invite: ["owner", "admin"],
    seeInvites: ["owner", "admin"],
    revokeInvite: ["owner", "admin"],
    changeRole: ["owner", "admin"],
    removeMember: ["owner", "admin"],
    deleteWorkspace: ["owner"],
    connectSocial: ["owner", "admin", "editor"],
    readChats: ["owner", "admin", "editor", "viewer"],
    chat: ["owner", "admin", "editor"],
    changeTeam: ["owner", "admin"],
    editKnowledge: ["owner", "admin", "editor"],
    editRoutines: ["owner", "admin", "editor"],
    editSkills: ["owner", "admin"],
    deleteMemory: ["owner", "admin", "editor", "viewer"],
    approve: ["owner", "admin", "editor"],
    viewApps: ["owner", "admin", "editor", "viewer"],
    connectApps: ["owner", "admin"],
  };
  assert.deepEqual(Object.keys(expected).sort(), Object.keys(NEEDS).sort());
  for (const [action, allowed] of Object.entries(expected) as [Action, Role[]][]) {
    for (const r of ROLES) assert.equal(can(r, action), allowed.includes(r), `${r} ${action}`);
  }
  assert.equal(can(null, "viewSettings"), false);
  assert.equal(atLeast(undefined, "viewer"), false);
});

test("nobody can be invited as or changed to owner", () => {
  assert.deepEqual(ASSIGNABLE, ["admin", "editor", "viewer"]);
});

test("member row actions: admins manage others, never the owner; anyone but the owner can leave", () => {
  const owner = { user_id: "o", email: "o@x.com", role: "owner" as Role };
  const admin2 = { user_id: "a2", email: "a2@x.com", role: "admin" as Role };
  const editor = { user_id: "e", email: "e@x.com", role: "editor" as Role };

  assert.deepEqual(memberActions({ userId: "o", role: "owner" }, owner), { changeRole: false, remove: false, leave: false });
  assert.deepEqual(memberActions({ userId: "o", role: "owner" }, editor), { changeRole: true, remove: true, leave: false });
  assert.deepEqual(memberActions({ userId: "a", role: "admin" }, owner), { changeRole: false, remove: false, leave: false });
  assert.deepEqual(memberActions({ userId: "a", role: "admin" }, admin2), { changeRole: true, remove: true, leave: false });
  assert.deepEqual(memberActions({ userId: "a2", role: "admin" }, admin2), { changeRole: false, remove: false, leave: true });
  assert.deepEqual(memberActions({ userId: "e", role: "editor" }, editor), { changeRole: false, remove: false, leave: true });
  assert.deepEqual(memberActions({ userId: "e", role: "editor" }, admin2), { changeRole: false, remove: false, leave: false });
  assert.deepEqual(memberActions({ userId: "v", role: "viewer" }, editor), { changeRole: false, remove: false, leave: false });
});

test("invite links and reading the token back", () => {
  const token = "a".repeat(64);
  assert.equal(inviteLink("https://app.morningtelos.com/", token), `https://app.morningtelos.com/invite/${token}`);
  assert.equal(inviteTokenFromPath(`/invite/${token}`), token);
  assert.equal(inviteTokenFromPath(`/invite/${token}/`), token);
  assert.equal(inviteTokenFromPath("/invite/"), null);
  assert.equal(inviteTokenFromPath("/invite/short"), null);
  assert.equal(inviteTokenFromPath("/invite/abc<script>xyz"), null);
  assert.equal(inviteTokenFromPath("/settings"), null);
});

test("delete needs the business name typed, ignoring case and extra spaces", () => {
  assert.equal(deleteConfirmMatches("Ana's Bakery", "Ana's Bakery"), true);
  assert.equal(deleteConfirmMatches("  ana's   bakery ", "Ana's Bakery"), true);
  assert.equal(deleteConfirmMatches("Ana's", "Ana's Bakery"), false);
  assert.equal(deleteConfirmMatches("", "Ana's Bakery"), false);
  assert.equal(deleteConfirmMatches("  ", "  "), false);
  assert.equal(deleteConfirmMatches(undefined, "Ana's Bakery"), false);
  assert.equal(deleteConfirmMatches(["Ana's Bakery"], "Ana's Bakery"), false);
});

test("settings form: cleans the website and checks the time zone", () => {
  assert.deepEqual(cleanSettings({ name: " Ana's Bakery ", website: "https://AnasBakery.com/", timezone: "America/New_York" }), {
    ok: true,
    value: { name: "Ana's Bakery", website: "anasbakery.com", timezone: "America/New_York" },
  });
  assert.deepEqual(cleanSettings({ name: "A", website: "", timezone: "UTC" }), { ok: true, value: { name: "A", website: null, timezone: "UTC" } });
  assert.equal(cleanSettings({ name: "", website: "", timezone: "UTC" }).ok, false);
  assert.equal(cleanSettings({ name: "x".repeat(121), website: "", timezone: "UTC" }).ok, false);
  assert.equal(cleanSettings({ name: "A", website: "not a site", timezone: "UTC" }).ok, false);
  assert.equal(cleanSettings({ name: "A", website: "", timezone: "Mars/Olympus" }).ok, false);
  assert.equal(cleanSettings({ name: "A", website: "", timezone: "" }).ok, false);
});

test("page routes", () => {
  assert.deepEqual(parseRoute("/"), { page: "home" });
  assert.deepEqual(parseRoute("/settings"), { page: "settings", tab: "general" });
  assert.deepEqual(parseRoute("/settings/"), { page: "settings", tab: "general" });
  assert.deepEqual(parseRoute("/settings/members"), { page: "settings", tab: "members" });
  assert.deepEqual(parseRoute("/settings/social"), { page: "settings", tab: "social" });
  assert.deepEqual(parseRoute("/knowledge"), { page: "knowledge" });
  assert.deepEqual(parseRoute("/knowledge/"), { page: "knowledge" });
  assert.deepEqual(parseRoute("/routines"), { page: "routines" });
  assert.deepEqual(parseRoute("/memory/"), { page: "memory" });
  assert.deepEqual(parseRoute("/settings/skills"), { page: "settings", tab: "skills" });
  assert.deepEqual(parseRoute("/settings/apps"), { page: "settings", tab: "apps" });
  assert.equal(routePath({ page: "settings", tab: "apps" }), "/settings/apps");
  assert.deepEqual(parseRoute("/nope"), { page: "home" });
  const token = "b".repeat(64);
  assert.deepEqual(parseRoute(`/invite/${token}`), { page: "invite", token });
  const thread = "11111111-2222-4333-8444-555555555555";
  assert.deepEqual(parseRoute("/team"), { page: "team" });
  assert.deepEqual(parseRoute("/chat"), { page: "thread", id: null });
  assert.deepEqual(parseRoute(`/chat/${thread}`), { page: "thread", id: thread });
  assert.deepEqual(parseRoute(`/chat/${thread.toUpperCase()}/`), { page: "thread", id: thread });
  assert.deepEqual(parseRoute("/chat/not-a-thread"), { page: "home" });
  assert.deepEqual(parseRoute("/approvals"), { page: "approvals", id: null });
  assert.deepEqual(parseRoute("/approvals/42"), { page: "approvals", id: 42 });
  assert.deepEqual(parseRoute("/approvals/0"), { page: "home" });
  assert.deepEqual(parseRoute("/approvals/abc"), { page: "home" });
  assert.deepEqual(parseRoute("/team/seo"), { page: "agent", key: "seo" });
  assert.deepEqual(parseRoute("/team/seo/"), { page: "agent", key: "seo" });
  assert.deepEqual(parseRoute("/team/zeus"), { page: "home" });
  assert.deepEqual(parseRoute("/billing"), { page: "billing" });
  for (const r of [
    { page: "approvals", id: null },
    { page: "approvals", id: 42 },
    { page: "home" },
    { page: "team" },
    { page: "thread", id: null },
    { page: "thread", id: thread },
    { page: "settings", tab: "general" },
    { page: "settings", tab: "members" },
    { page: "settings", tab: "social" },
    { page: "knowledge" },
    { page: "routines" },
    { page: "memory" },
    { page: "settings", tab: "skills" },
    { page: "agent", key: "email" },
    { page: "billing" },
    { page: "invite", token },
  ] as const) {
    assert.deepEqual(parseRoute(routePath(r)), r);
  }
});

test("invite and goodbye emails escape names and include the link", () => {
  const m = inviteMail({ workspace: "<Ana & Co>", inviter: "ana@example.com", role: "admin", link: "https://app.example/invite/tok" });
  assert.match(m.subject, /Join <Ana & Co> on Morning Telos/);
  assert.ok(!m.html.includes("<Ana"), "workspace name is escaped in HTML");
  assert.match(m.html, /&lt;Ana &amp; Co&gt;/);
  assert.match(m.html, /href="https:\/\/app\.example\/invite\/tok"/);
  assert.match(m.text, /https:\/\/app\.example\/invite\/tok/);
  assert.match(m.text, /as an admin/);
  assert.match(inviteMail({ workspace: "W", inviter: null, role: "editor", link: "x" }).text, /^You were invited to join W on Morning Telos as an editor\./);
  assert.match(inviteMail({ workspace: "W", inviter: null, role: "viewer", link: "x" }).text, /as a viewer\./);
  const g = goodbyeMail({ workspace: "Bye Co" });
  assert.match(g.subject, /Bye Co was deleted/);
  assert.match(g.text, /is deleted/);
});

test("sendMail skips without a key and posts to Resend with one", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fake = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  const mail = goodbyeMail({ workspace: "W" });
  assert.equal(await sendMail({ key: "", from: "x", fetch: fake }, "a@b.com", mail), false);
  assert.equal(calls.length, 0);
  assert.equal(await sendMail({ key: "re_test", from: "MT <hi@mt.com>", fetch: fake }, "a@b.com", mail), true);
  assert.equal(calls[0].url, "https://api.resend.com/emails");
  assert.equal((calls[0].init?.headers as Record<string, string>).Authorization, "Bearer re_test");
  const body = JSON.parse(String(calls[0].init?.body));
  assert.deepEqual(body.to, ["a@b.com"]);
  assert.equal(body.from, "MT <hi@mt.com>");
  const failing = (async () => new Response("no", { status: 422 })) as unknown as typeof fetch;
  await assert.rejects(sendMail({ key: "re_test", from: "x", fetch: failing }, "a@b.com", mail), /422/);
});
