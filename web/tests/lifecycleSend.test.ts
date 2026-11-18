// The hourly lifecycle_emails job with a fake store and a fake fetch (src/lib/lifecycleSend.ts). Nothing real is called.
import assert from "node:assert/strict";
import test from "node:test";
import { RESEND_URL } from "../src/lib/email.ts";
import { sendLifecycleEmails, type LifecycleDeps, type LifecycleStore, type LogRow, type StoredWorkspace } from "../src/lib/lifecycleSend.ts";

const OWNER = { userId: "11111111-1111-4111-8111-111111111111", email: "ana@example.com" };
const trial: StoredWorkspace = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Ana's Bakery", plan: "trial", status: "trialing", trial_ends_at: "2026-11-30T21:30:00.000Z", timezone: "America/Chicago", created_at: "2026-11-16T21:30:00.000Z" };
const paid: StoredWorkspace = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Bo's Plumbing", plan: "starter", status: "active", trial_ends_at: "2026-10-01T00:00:00Z", period_start: "2026-11-10T00:00:00.000Z", timezone: "America/Chicago", created_at: "2026-09-01T00:00:00Z" };

type Sent = { url: string; headers: Record<string, string>; body: Record<string, unknown> };

function setup(o: { list?: StoredWorkspace[]; spent?: number; digestOn?: boolean; status?: number; link?: string | null; failSpendFor?: string } = {}) {
  const claims = new Set<string>();
  const unclaimed: LogRow[] = [];
  const statsAsked: [string, string, string][] = [];
  const sent: Sent[] = [];
  const logs: string[] = [];
  let status = o.status ?? 200;
  const key = (r: LogRow) => `${r.workspace_id}|${r.user_id}|${r.kind}|${r.period_key}`;
  const store: LifecycleStore = {
    workspaces: async () => o.list ?? [trial],
    spend: async (ws) => {
      if (ws === o.failSpendFor) throw new Error("database busy");
      return o.spent ?? 0;
    },
    owners: async () => [OWNER],
    digestOn: async () => o.digestOn ?? true,
    stats: async (ws, from, to) => {
      statsAsked.push([ws, from, to]);
      return { chats: 3, approvals: 1, routines: 0 };
    },
    claim: async (r) => {
      if (claims.has(key(r))) return false;
      claims.add(key(r));
      return true;
    },
    unclaim: async (r) => {
      claims.delete(key(r));
      unclaimed.push(r);
    },
  };
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) });
    return new Response(status === 200 ? '{"id":"em_1"}' : "busy", { status });
  }) as typeof fetch;
  let now = Date.parse("2026-11-22T15:00:00Z");
  const deps: LifecycleDeps = {
    store,
    resend: { key: "re_test", from: "Morning Telos <meet@morningtelos.com>", fetch: fakeFetch },
    appUrl: "https://chat.example.test",
    now: () => now,
    unsubscribeUrl: (ws, user) => (o.link === undefined ? `https://chat.example.test/api/email/unsubscribe?t=${ws}.${user}` : o.link),
    log: (m) => logs.push(m),
  };
  return { deps, claims, unclaimed, statsAsked, sent, logs, at: (iso: string) => (now = Date.parse(iso)), fail: (s: number) => (status = s) };
}

test("nothing is sent and nothing is claimed while Resend isn't set up", async () => {
  const s = setup();
  const run = await sendLifecycleEmails({ ...s.deps, resend: { ...s.deps.resend, key: "" } });
  assert.equal(run.off, "RESEND_API_KEY is not set.");
  assert.equal(s.sent.length, 0);
  assert.equal(s.claims.size, 0);
});

test("day 7 goes to the owner once, with the trial's stats and an idempotency key", async () => {
  const s = setup();
  const run = await sendLifecycleEmails(s.deps);
  assert.deepEqual(run, { sent: 1, skipped: 0, failed: 0 });
  assert.equal(s.sent.length, 1);
  const [m] = s.sent;
  assert.equal(m.url, RESEND_URL);
  assert.equal(m.headers.Authorization, "Bearer re_test");
  assert.equal(m.headers["Idempotency-Key"], `lifecycle/trial_day7/${trial.id}/${OWNER.userId}/2026-11-30`);
  assert.deepEqual(m.body.to, ["ana@example.com"]);
  assert.equal(m.body.subject, "Your first week with your AI team");
  assert.match(String(m.body.text), /3 chats/);
  assert.match(String(m.body.text), /1 approval done/);
  assert.equal(m.body.headers, undefined, "trial emails have no unsubscribe");
  // From the trial's start to now.
  assert.deepEqual(s.statsAsked, [[trial.id, "2026-11-16T21:30:00.000Z", "2026-11-22T15:00:00.000Z"]]);
  assert.ok(s.claims.has(`${trial.id}|${OWNER.userId}|trial_day7|2026-11-30`));

  // The next hourly run finds the claim and sends nothing.
  s.at("2026-11-22T16:00:00Z");
  const again = await sendLifecycleEmails(s.deps);
  assert.deepEqual(again, { sent: 0, skipped: 1, failed: 0 });
  assert.equal(s.sent.length, 1);
});

test("when Resend says no, the claim is taken back so the next run tries again with the same key", async () => {
  const s = setup({ status: 500 });
  const run = await sendLifecycleEmails(s.deps);
  assert.deepEqual(run, { sent: 0, skipped: 0, failed: 1 });
  assert.equal(s.unclaimed.length, 1);
  assert.equal(s.claims.size, 0);
  assert.match(s.logs[0], /trial_day7.*Resend returned 500/);
  s.fail(200);
  s.at("2026-11-22T16:00:00Z");
  assert.equal((await sendLifecycleEmails(s.deps)).sent, 1);
  assert.equal(s.sent[0].headers["Idempotency-Key"], s.sent[1].headers["Idempotency-Key"]);
});

test("the weekly digest carries the unsubscribe link and List-Unsubscribe headers", async () => {
  const s = setup({ list: [paid] });
  s.at("2026-11-23T15:00:00Z");
  const run = await sendLifecycleEmails(s.deps);
  assert.equal(run.sent, 1);
  const [m] = s.sent;
  const link = `https://chat.example.test/api/email/unsubscribe?t=${paid.id}.${OWNER.userId}`;
  assert.deepEqual(m.body.headers, { "List-Unsubscribe": `<${link}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
  assert.match(String(m.body.text), new RegExp(`Unsubscribe: ${link.replace(/[.?]/g, "\\$&")}`));
  assert.equal(m.body.subject, "Your team's week at Bo's Plumbing");
  assert.deepEqual(s.statsAsked, [[paid.id, "2026-11-16T06:00:00.000Z", "2026-11-23T06:00:00.000Z"]]);
});

test("the digest is skipped for people who turned it off, and when no unsubscribe link can be made", async () => {
  const off = setup({ list: [paid], digestOn: false });
  off.at("2026-11-23T15:00:00Z");
  assert.deepEqual(await sendLifecycleEmails(off.deps), { sent: 0, skipped: 1, failed: 0 });
  assert.equal(off.sent.length, 0);
  assert.equal(off.claims.size, 0);

  const noLink = setup({ list: [paid], link: null });
  noLink.at("2026-11-23T15:00:00Z");
  assert.deepEqual(await sendLifecycleEmails(noLink.deps), { sent: 0, skipped: 1, failed: 0 });
  assert.equal(noLink.sent.length, 0);
});

test("turning off the digest never stops trial and billing emails", async () => {
  const s = setup({ list: [paid], digestOn: false, spent: 10 });
  s.at("2026-11-20T15:00:00Z");
  const run = await sendLifecycleEmails(s.deps);
  assert.equal(run.sent, 1);
  assert.equal(s.sent[0].body.subject, "Your team used 83% of its AI allowance");
  assert.match(String(s.sent[0].body.text), /Upgrade your plan for more/);
});

test("one workspace that fails never stops the rest", async () => {
  const s = setup({ list: [{ ...paid, id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }, trial], failSpendFor: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" });
  const run = await sendLifecycleEmails(s.deps);
  assert.deepEqual(run, { sent: 1, skipped: 0, failed: 1 });
  assert.match(s.logs[0], /database busy/);
});
