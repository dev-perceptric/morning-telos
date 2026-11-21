// Iris's campaigns: the list and the words (src/lib/campaigns.ts), the sender (src/lib/campaignSend.ts), approving
// and testing (src/lib/emailWork.ts) and her tools (src/lib/campaignTools.ts). Fakes only: no Gmail, no database.
import assert from "node:assert/strict";
import test from "node:test";
import type { ToolContext } from "../src/lib/agentLoop.ts";
import { sendDue, type DueCampaign, type SendDeps } from "../src/lib/campaignSend.ts";
import { campaignToolSource, type CampaignToolDeps } from "../src/lib/campaignTools.ts";
import { batchSize, campaignsSummary, cleanAddress, cleanCampaign, emailFor, fillIn, footer, parseContacts } from "../src/lib/campaigns.ts";
import { EMAIL_MESSAGES, emailAct, unsubscribePage, type EmailDeps } from "../src/lib/emailWork.ts";

// ─────────────── the list and the words ───────────────

test("parseContacts reads a CSV with a header, or plain rows, and skips bad and repeated emails", () => {
  const withHead = parseContacts('Name,Email,List\n"Lopez, Maria",MARIA@lopez.com,VIP\nDan Price,dan@price.com,\nNo Email,,x\nAgain,maria@lopez.com,VIP\n', "Customers");
  assert.deepEqual(withHead, {
    rows: [
      { email: "maria@lopez.com", name: "Lopez, Maria", list: "VIP" },
      { email: "dan@price.com", name: "Dan Price", list: "Customers" },
    ],
    bad: 2,
  });
  assert.deepEqual(parseContacts("ana@ruiz.com,Ana Ruiz\nnot-an-email\n", "Leads"), { rows: [{ email: "ana@ruiz.com", name: "Ana Ruiz", list: "Leads" }], bad: 1 });
  assert.deepEqual(parseContacts("﻿email;first_name\nx@y.co;Xi\n").rows, [{ email: "x@y.co", name: "Xi", list: "Customers" }]);
  assert.deepEqual(parseContacts(""), { rows: [], bad: 0 });
});

test("fillIn, footer and emailFor make each person's email", () => {
  assert.equal(fillIn("Hi {{first_name}}, {{ name }}!", { name: "Maria Lopez" }), "Hi Maria, Maria Lopez!");
  assert.equal(fillIn("Hi {{first_name}},", { name: "" }), "Hi there,");
  const foot = footer("Perceptric", "123 Main St\nAustin, TX 78701", "https://app.test/api/unsubscribe?t=abc");
  assert.match(foot, /^\n\n--\nPerceptric\n123 Main St\nAustin, TX 78701\nYou're getting this because you're on Perceptric's list\. Unsubscribe: https:\/\/app\.test\/api\/unsubscribe\?t=abc$/);
  assert.deepEqual(emailFor({ name: "Dan Price" }, { subject: "For {{first_name}}", body: "Hi {{first_name}}" }, "\n\nfoot"), { subject: "For Dan", body: "Hi Dan\n\nfoot" });
});

test("batchSize keeps each run small and each inbox under its daily limit", () => {
  assert.equal(batchSize("gmail", 0), 20);
  assert.equal(batchSize("gmail", 390), 10);
  assert.equal(batchSize("gmail", 400), 0);
  assert.equal(batchSize("outlook", 245), 5);
});

test("cleanCampaign, cleanAddress and campaignsSummary", () => {
  assert.deepEqual(cleanCampaign({ subject: " News ", body: " Hi ", list: "" }), { ok: true, value: { subject: "News", body: "Hi", list: null } });
  assert.deepEqual(cleanCampaign({ subject: "", body: "x" }), { ok: false, error: "Write the subject." });
  assert.deepEqual(cleanCampaign({ subject: "x", body: " " }), { ok: false, error: "Write the email." });
  assert.equal(cleanAddress("123 Main St, Austin TX"), "123 Main St, Austin TX");
  assert.equal(cleanAddress("Austin"), null);
  assert.equal(cleanAddress(null), null);
  assert.equal(campaignsSummary([], 0), null);
  assert.equal(campaignsSummary([{ status: "scheduled", sent_count: 0 }, { status: "sent", sent_count: 212 }], 230), "230 people on your list, 1 campaign going out, the last one went to 212.");
});

// ─────────────── the sender ───────────────

const NOW = Date.parse("2027-01-08T12:00:00Z");
const camp = (o: Partial<DueCampaign> = {}): DueCampaign => ({ id: "c1", workspace_id: "w1", subject: "News for {{first_name}}", body: "Hi {{first_name}}", list: null, status: "scheduled", sent_count: 0, failed_count: 0, from_app: null, ...o });
const people = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ id: `p${from + i}`, email: `p${from + i}@x.com`, name: `Person ${from + i}`, token: `t${from + i}` }));

function sender(o: { due?: DueCampaign[]; inbox?: "gmail" | "outlook" | null; address?: boolean; sentToday?: number; contacts?: ReturnType<typeof people>; fail?: (to: string) => Error | null } = {}) {
  const sends: { to: string; subject: string; body: string }[] = [];
  const records: { contact_id: string; status: string; error: string | null }[] = [];
  const updates: [string, Record<string, unknown>][] = [];
  let pool = o.contacts ?? people(3);
  const deps: SendDeps = {
    due: async () => o.due ?? [camp()],
    inbox: async () => (o.inbox === undefined ? "gmail" : o.inbox),
    sender: async () => (o.address === false ? null : { business: "Perceptric", address: "123 Main St, Austin TX" }),
    sentToday: async () => o.sentToday ?? 0,
    next: async (_id, n) => pool.slice(0, n),
    send: async (_ws, _app, to, subject, body) => {
      const e = o.fail?.(to);
      if (e) throw e;
      sends.push({ to, subject, body });
    },
    record: async (r) => {
      records.push({ contact_id: r.contact_id, status: r.status, error: r.error });
      pool = pool.filter((p) => p.id !== r.contact_id);
    },
    update: async (id, patch) => void updates.push([id, patch]),
    unsubscribeUrl: (t) => `https://app.test/api/unsubscribe?t=${t}`,
    log: () => {},
    now: () => NOW,
  };
  return { deps, sends, records, updates };
}

test("sendDue sends each person their own email with the footer, and finishes a small list", async () => {
  const s = sender();
  assert.deepEqual(await sendDue(s.deps), { sent: 3, failed: 0, finished: 1 });
  assert.deepEqual(s.sends[0], { to: "p0@x.com", subject: "News for Person", body: "Hi Person\n\n--\nPerceptric\n123 Main St, Austin TX\nYou're getting this because you're on Perceptric's list. Unsubscribe: https://app.test/api/unsubscribe?t=t0" });
  assert.deepEqual(s.updates, [
    ["c1", { status: "sending", from_app: "gmail" }],
    ["c1", { sent_count: 3, failed_count: 0, status: "sent" }],
  ]);
});

test("sendDue sends a big list a batch at a time, and stops at the inbox's daily limit", async () => {
  const big = sender({ contacts: people(50) });
  assert.deepEqual(await sendDue(big.deps), { sent: 20, failed: 0, finished: 0 });
  assert.deepEqual(big.updates.at(-1), ["c1", { sent_count: 20, failed_count: 0 }]);
  const nearlyFull = sender({ contacts: people(50), sentToday: 395 });
  assert.equal((await sendDue(nearlyFull.deps)).sent, 5);
  const full = sender({ contacts: people(50), sentToday: 400 });
  assert.deepEqual(await sendDue(full.deps), { sent: 0, failed: 0, finished: 0 });
  assert.deepEqual(full.updates, [], "a full day changes nothing");
});

test("sendDue waits without an inbox or an address, records one bad address, and stops when the inbox can't send", async () => {
  for (const s of [sender({ inbox: null }), sender({ address: false })]) {
    assert.deepEqual(await sendDue(s.deps), { sent: 0, failed: 0, finished: 0 });
    assert.equal(s.sends.length + s.updates.length, 0);
  }
  const oneBad = sender({ fail: (to) => (to === "p1@x.com" ? new Error("Invalid recipient") : null) });
  assert.deepEqual(await sendDue(oneBad.deps), { sent: 2, failed: 1, finished: 1 });
  assert.deepEqual(oneBad.records.find((r) => r.contact_id === "p1"), { contact_id: "p1", status: "failed", error: "Invalid recipient" });
  const gone = sender({ due: [camp(), camp({ id: "c2" })], fail: () => Object.assign(new Error("Connect Gmail again in Settings, Apps."), { stop: true }) });
  assert.deepEqual(await sendDue(gone.deps), { sent: 0, failed: 0, finished: 0 });
  assert.deepEqual(gone.records, [], "nobody is marked when the inbox itself can't send");
  assert.equal(gone.updates.filter(([id]) => id === "c2").length, 0, "the workspace's other campaigns wait too");
});

// ─────────────── approving and testing ───────────────

const ID = "11111111-1111-4111-8111-111111111111";
function email(o: Partial<{ status: string; address: boolean; inbox: "gmail" | null; reachable: number; role: "viewer" | "editor"; userEmail: string | null }> = {}) {
  const sent: [string, string, string][] = [];
  const scheduled: [string, Record<string, unknown>][] = [];
  const deps: EmailDeps = {
    gate: async (min) => ((o.role ?? "editor") === "viewer" && min !== "viewer" ? { ok: false, status: 403, error: "Not allowed." } : { ok: true, userId: "u1", email: o.userEmail === undefined ? "owner@biz.com" : o.userEmail }),
    campaign: async (id) => (id === ID ? { id, subject: "News for {{first_name}}", body: "Hi {{first_name}}", list: "VIP", status: (o.status ?? "draft") as "draft" } : null),
    sender: async () => (o.address === false ? null : { business: "Perceptric", address: "123 Main St, Austin TX" }),
    inbox: async () => (o.inbox === undefined ? "gmail" : o.inbox),
    reachable: async () => o.reachable ?? 40,
    schedule: async (id, patch) => void scheduled.push([id, patch]),
    send: async (_app, to, subject) => void sent.push([to, subject, ""]),
    unsubscribeUrl: "https://app.test/api/unsubscribe",
    activity: async () => {},
    now: () => NOW,
  };
  return { deps, sent, scheduled };
}

test("emailAct schedules a draft for its list, and sends a test to the person", async () => {
  const s = email();
  assert.deepEqual(await emailAct({ action: "schedule", campaignId: ID, sendAt: "2027-01-09T09:00:00Z" }, s.deps), { status: 200, body: { ok: true, people: 40 } });
  assert.deepEqual(s.scheduled, [[ID, { status: "scheduled", send_at: "2027-01-09T09:00:00.000Z", from_app: "gmail", approved_by: "u1" }]]);
  assert.deepEqual(await emailAct({ action: "test", campaignId: ID }, s.deps), { status: 200, body: { ok: true, to: "owner@biz.com" } });
  assert.deepEqual(s.sent, [["owner@biz.com", "[Test] News for there", ""]]);
});

test("emailAct checks the address the law needs, the inbox, the list, the time and the role first", async () => {
  const cases: [ReturnType<typeof email>, Record<string, unknown>, number, string][] = [
    [email({ address: false }), { action: "schedule", campaignId: ID }, 409, EMAIL_MESSAGES.address],
    [email({ inbox: null }), { action: "schedule", campaignId: ID }, 409, EMAIL_MESSAGES.inbox],
    [email({ reachable: 0 }), { action: "schedule", campaignId: ID }, 409, EMAIL_MESSAGES.empty],
    [email({ status: "scheduled" }), { action: "schedule", campaignId: ID }, 409, EMAIL_MESSAGES.notDraft],
    [email(), { action: "schedule", campaignId: ID, sendAt: "2026-01-01T00:00:00Z" }, 400, EMAIL_MESSAGES.time],
    [email(), { action: "schedule", campaignId: "nope" }, 404, EMAIL_MESSAGES.campaign],
    [email({ userEmail: null }), { action: "test", campaignId: ID }, 400, EMAIL_MESSAGES.noEmail],
    [email({ role: "viewer" }), { action: "schedule", campaignId: ID }, 403, "Not allowed."],
  ];
  for (const [s, b, status, error] of cases) {
    assert.deepEqual(await emailAct(b, s.deps), { status, body: { error } }, error);
    assert.equal(s.scheduled.length + s.sent.length, 0);
  }
});

test("unsubscribePage asks first, so a mail scanner opening the link can't unsubscribe anyone", () => {
  const ask = unsubscribePage("ask", "0123456789abcdef0123456789abcdef");
  assert.match(ask, /<form method="post"><input type="hidden" name="t" value="0123456789abcdef0123456789abcdef"><button type="submit">Unsubscribe<\/button><\/form>/);
  const odd = unsubscribePage("ask", '"><script>x</script>');
  assert.match(odd, /value="[0-9a-f]*">/);
  assert.doesNotMatch(odd, /<script/);
  assert.match(unsubscribePage("done"), /You're unsubscribed\./);
  assert.match(unsubscribePage("bad"), /That link didn't work\./);
});

// ─────────────── Iris's tools ───────────────

const WS = { id: "w1", name: "B", website: null } as ToolContext["workspace"];
const ctx = (agent: ToolContext["agent"]): ToolContext => ({ workspace: WS, agent, threadId: "t1", trust: 0, emit: () => {} });

test("only Iris gets save_campaign and mailing_lists; drafts are saved and changed, sent ones aren't", async () => {
  const calls: string[] = [];
  const deps: CampaignToolDeps = {
    byId: async (_ws, id) => (id === ID ? { id, status: "draft", subject: "Old" } : id === "22222222-2222-4222-8222-222222222222" ? { id, status: "sent", subject: "Done" } : null),
    insert: async (ws, c) => (calls.push(`insert ${ws} ${c.subject} ${c.source}`), { id: "33333333-3333-4333-8333-333333333333" }),
    update: async (ws, id, c) => void calls.push(`update ${ws} ${id} ${c.subject}`),
    lists: async () => [{ list: "Customers", people: 212 }],
  };
  const src = campaignToolSource(deps);
  assert.deepEqual((await src(ctx("sales"))).tools, []);
  const [save, lists] = (await src(ctx("email"))).tools;
  assert.match(String((await save.run({ subject: "News", body: "Hi {{first_name}}" }, ctx("email"))).content), /^Saved the draft "News" \(id 33333333/);
  assert.match(String((await save.run({ id: ID, subject: "New", body: "x" }, ctx("email"))).content), /^Changed the draft "New"/);
  assert.equal((await save.run({ id: "22222222-2222-4222-8222-222222222222", subject: "x", body: "y" }, ctx("email"))).isError, true);
  assert.deepEqual(await save.run({ subject: "", body: "y" }, ctx("email")), { content: "Write the subject.", isError: true });
  assert.deepEqual(calls, ["insert w1 News iris", `update w1 ${ID} New`]);
  assert.equal((await lists.run({}, ctx("email"))).content, "Customers: 212 people");
});
