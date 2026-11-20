// The staff console's pure parts (src/lib/staff.ts): who is staff, the workspace rows, search, the top strip, input
// checks, and staffRoute with fake deps.
import assert from "node:assert/strict";
import test from "node:test";
import {
  actionLine,
  extendedTrialEnd,
  isFailedJob,
  isStaff,
  monthStart,
  planPatch,
  readDays,
  readJobId,
  searchWorkspaces,
  staffEmails,
  staffRoute,
  STAFF_MESSAGES,
  summarize,
  toStaffWorkspace,
  trialEndingSoon,
  type StaffDeps,
  type StaffWorkspaceRow,
} from "../src/lib/staff.ts";
import { effectivePlan } from "../src/lib/plans.ts";

const NOW = Date.parse("2026-11-18T12:00:00Z");
const DAY = 864e5;
const iso = (ms: number) => new Date(ms).toISOString();
const WS = "11111111-2222-4333-8444-555555555555";
const WS2 = "11111111-2222-4333-8444-666666666666";

const row = (o: Partial<StaffWorkspaceRow> = {}): StaffWorkspaceRow => ({
  id: WS,
  name: "Ana's Bakery",
  website: "anasbakery.com",
  plan: "trial",
  status: "trialing",
  trial_ends_at: iso(NOW + 10 * DAY),
  period_start: iso(NOW - 4 * DAY),
  stripe_subscription_id: null,
  created_at: iso(NOW - 4 * DAY),
  owner_email: "ana@example.com",
  members: 2,
  ai_usd: "1.239",
  ...o,
});

test("staffEmails: a comma list, trimmed and lowercase; junk and empty mean nobody", () => {
  assert.deepEqual([...staffEmails(" Vin@MorningTelos.com, b@morningtelos.com ,,not-an-email")], ["vin@morningtelos.com", "b@morningtelos.com"]);
  assert.equal(staffEmails("").size, 0);
  assert.equal(staffEmails(undefined).size, 0);
  assert.equal(staffEmails(null).size, 0);
});

test("isStaff: only a confirmed email in the list, any case", () => {
  const list = "vin@morningtelos.com";
  const ok = { id: "u1", email: "Vin@MorningTelos.com", email_confirmed_at: "2026-01-01T00:00:00Z" };
  assert.equal(isStaff(ok, list), true);
  assert.equal(isStaff({ ...ok, email_confirmed_at: null }, list), false, "unconfirmed email");
  assert.equal(isStaff({ ...ok, email_confirmed_at: undefined }, list), false);
  assert.equal(isStaff({ ...ok, email: "other@morningtelos.com" }, list), false);
  assert.equal(isStaff({ ...ok, email: null }, list), false);
  assert.equal(isStaff({ ...ok, id: "" }, list), false);
  assert.equal(isStaff(ok, ""), false, "no STAFF_EMAILS means nobody");
  assert.equal(isStaff(ok, undefined), false);
  assert.equal(isStaff(null, list), false);
  // A list entry is a whole email, never a part of one.
  assert.equal(isStaff({ ...ok, email: "in@morningtelos.com" }, list), false);
});

test("monthStart is the first of this month in UTC", () => {
  assert.equal(monthStart(NOW), "2026-11-01T00:00:00.000Z");
  assert.equal(monthStart(Date.parse("2026-12-31T23:59:59Z")), "2026-12-01T00:00:00.000Z");
  assert.equal(monthStart(Date.parse("2027-01-01T00:00:00Z")), "2027-01-01T00:00:00.000Z");
});

test("extendedTrialEnd counts from the trial's end, or from now when it already ended", () => {
  assert.equal(extendedTrialEnd(iso(NOW + 2 * DAY), 7, NOW), iso(NOW + 9 * DAY));
  assert.equal(extendedTrialEnd(iso(NOW - 5 * DAY), 7, NOW), iso(NOW + 7 * DAY));
  assert.equal(extendedTrialEnd(null, 3, NOW), iso(NOW + 3 * DAY));
  assert.equal(extendedTrialEnd("nonsense", 1, NOW), iso(NOW + DAY));
});

test("toStaffWorkspace: plan in force from effectivePlan, money to the cent, allowance, Stripe flag", () => {
  const w = toStaffWorkspace(row(), NOW);
  assert.equal(w.effective, "trial");
  assert.equal(w.daysLeft, 10);
  assert.equal(w.aiMonth, 1.24);
  assert.equal(w.allowance, 5);
  assert.equal(w.ownerEmail, "ana@example.com");
  assert.equal(w.stripe, false);
  assert.equal(w.members, 2);
  const expired = toStaffWorkspace(row({ trial_ends_at: iso(NOW - DAY), ai_usd: null }), NOW);
  assert.equal(expired.effective, "expired");
  assert.equal(expired.aiMonth, 0);
  assert.equal(expired.allowance, 0);
  const internal = toStaffWorkspace(row({ plan: "internal", status: "active" }), NOW);
  assert.equal(internal.effective, "internal");
  assert.equal(internal.allowance, null);
  const pro = toStaffWorkspace(row({ plan: "pro", status: "active", stripe_subscription_id: "sub_1", ai_usd: 12 }), NOW);
  assert.equal(pro.effective, "pro");
  assert.equal(pro.allowance, 50);
  assert.equal(pro.stripe, true);
  // Same rule as the app everywhere else.
  for (const r of [row(), row({ plan: "starter", status: "canceled" }), row({ plan: "pro", status: "past_due" })]) {
    assert.equal(toStaffWorkspace(r, NOW).effective, effectivePlan(r, NOW).plan);
  }
});

test("searchWorkspaces: every word in the name, owner email or website, any case; empty finds all", () => {
  const rows = [
    { name: "Ana's Bakery", ownerEmail: "ana@example.com", website: "anasbakery.com" },
    { name: "Bo's Plumbing", ownerEmail: "bo@plumb.io", website: null },
    { name: "Cy Co", ownerEmail: null },
  ];
  assert.equal(searchWorkspaces(rows, "").length, 3);
  assert.equal(searchWorkspaces(rows, "   ").length, 3);
  assert.equal(searchWorkspaces(rows, undefined).length, 3);
  assert.deepEqual(searchWorkspaces(rows, "BAKERY").map((r) => r.name), ["Ana's Bakery"]);
  assert.deepEqual(searchWorkspaces(rows, "plumb.io").map((r) => r.name), ["Bo's Plumbing"]);
  assert.deepEqual(searchWorkspaces(rows, "anasbakery").map((r) => r.name), ["Ana's Bakery"]);
  assert.deepEqual(searchWorkspaces(rows, "bo plumbing").map((r) => r.name), ["Bo's Plumbing"]);
  assert.deepEqual(searchWorkspaces(rows, "ana plumbing"), []);
  assert.deepEqual(searchWorkspaces(rows, "cy").map((r) => r.name), ["Cy Co"]);
});

test("trialEndingSoon: a trial in force ending within 3 days", () => {
  assert.equal(trialEndingSoon({ effective: "trial", trialEndsAt: iso(NOW + 2 * DAY) }, NOW), true);
  assert.equal(trialEndingSoon({ effective: "trial", trialEndsAt: iso(NOW + 3 * DAY) }, NOW), true);
  assert.equal(trialEndingSoon({ effective: "trial", trialEndsAt: iso(NOW + 3 * DAY + 1) }, NOW), false);
  assert.equal(trialEndingSoon({ effective: "expired", trialEndsAt: iso(NOW - 1) }, NOW), false);
  assert.equal(trialEndingSoon({ effective: "pro", trialEndsAt: iso(NOW + DAY) }, NOW), false, "a paid plan's old trial date doesn't count");
  assert.equal(trialEndingSoon({ effective: "trial", trialEndsAt: null }, NOW), false);
});

test("summarize: workspaces by plan in force, trials ending, failed jobs and AI spend", () => {
  const rows = [
    row(),
    row({ id: "b", trial_ends_at: iso(NOW + DAY) }),
    row({ id: "c", plan: "pro", status: "active" }),
    row({ id: "d", trial_ends_at: iso(NOW - DAY) }),
    row({ id: "e", plan: "internal", status: "active" }),
  ].map((r) => toStaffWorkspace(r, NOW));
  const s = summarize(rows, { failedJobs: 3, aiTotal: "10.456" }, NOW);
  assert.equal(s.workspaces, 5);
  assert.deepEqual(s.byPlan, { trial: 2, starter: 0, pro: 1, internal: 1, expired: 1 });
  assert.equal(s.trialsEnding, 1);
  assert.equal(s.failedJobs, 3);
  assert.equal(s.aiMonth, 10.46);
  assert.equal(summarize([], { failedJobs: 0, aiTotal: null }, NOW).aiMonth, 0);
  assert.equal(s.droppedEmails, 0, "no count before the email door's table exists");
  assert.equal(summarize([], { failedJobs: 0, aiTotal: 0, droppedEmails: 12 }, NOW).droppedEmails, 12);
  assert.equal(summarize([], { failedJobs: 0, aiTotal: 0, droppedEmails: Number.NaN }, NOW).droppedEmails, 0);
});

test("isFailedJob: not done and every attempt used", () => {
  assert.equal(isFailedJob({ attempts: 5, max_attempts: 5, done_at: null }), true);
  assert.equal(isFailedJob({ attempts: 6, max_attempts: 5, done_at: null }), true);
  assert.equal(isFailedJob({ attempts: 4, max_attempts: 5, done_at: null }), false, "still trying");
  assert.equal(isFailedJob({ attempts: 5, max_attempts: 5, done_at: iso(NOW) }), false, "done");
});

test("planPatch: a trial is trialing, every other plan set by hand is active, and the plan then counts", () => {
  assert.deepEqual(planPatch("trial"), { plan: "trial", status: "trialing" });
  for (const p of ["starter", "pro", "internal"] as const) {
    assert.deepEqual(planPatch(p), { plan: p, status: "active" });
    assert.equal(effectivePlan({ ...planPatch(p), trial_ends_at: iso(NOW - DAY) }, NOW).plan, p);
  }
});

test("readDays and readJobId take whole numbers in range only", () => {
  assert.equal(readDays(7), 7);
  assert.equal(readDays("14"), 14);
  assert.equal(readDays(1), 1);
  assert.equal(readDays(90), 90);
  for (const bad of [0, 91, -1, 1.5, "", " ", "abc", null, undefined, true, "7 days"]) assert.equal(readDays(bad), null, String(bad));
  assert.equal(readJobId(12), 12);
  assert.equal(readJobId("12"), 12);
  for (const bad of [0, -3, 1.2, "1e3", "", null, undefined, "12;drop"]) assert.equal(readJobId(bad), null, String(bad));
});

test("actionLine says what a staff change did, in plain words", () => {
  assert.equal(actionLine({ action: "set_plan", details: { from: { plan: "trial", status: "trialing" }, to: { plan: "pro", status: "active" } } }), "Plan changed from Free trial to Pro");
  assert.equal(actionLine({ action: "extend_trial", details: { days: 7 } }), "Trial extended by 7 days");
  assert.equal(actionLine({ action: "extend_trial", details: { days: 1 } }), "Trial extended by 1 day");
  assert.equal(actionLine({ action: "retry_job", details: { job: 4, kind: "provision" } }), "Job provision sent to run again");
  assert.equal(actionLine({ action: "other", details: {} }), "other");
});

// ─────────────── staffRoute ───────────────

function deps(o: Partial<StaffDeps> = {}) {
  const calls: { fn: string; args: unknown[] }[] = [];
  const rec =
    <T>(fn: string, out: T) =>
    async (...args: unknown[]) => {
      calls.push({ fn, args });
      return out;
    };
  const d: StaffDeps = {
    staff: async () => ({ userId: "staff1", email: "vin@morningtelos.com" }),
    now: () => NOW,
    workspaces: async (_since, id) => [row(), row({ id: WS2, name: "Bo's Plumbing", owner_email: "bo@plumb.io", plan: "pro", status: "active" })].filter((r) => !id || r.id === id),
    aiTotal: async () => "3.5",
    openJobsSince: async () => [
      { attempts: 5, max_attempts: 5, done_at: null },
      { attempts: 1, max_attempts: 5, done_at: null },
    ],
    openJobs: async () => [
      { id: 1, kind: "provision", attempts: 5, max_attempts: 5, last_error: "Arrowsterr did not answer in time.", run_at: iso(NOW - DAY), created_at: iso(NOW - 2 * DAY), done_at: null },
      { id: 2, kind: "scan_website", attempts: 1, max_attempts: 5, last_error: null, run_at: iso(NOW), created_at: iso(NOW), done_at: null },
    ],
    services: async () => [{ product: "arrowsterr", status: "failed", brand_id: null, key_prefix: null, last_error: "x", updated_at: iso(NOW) }],
    pendingBefore: rec("pendingBefore", [{ id: 9, agent: "social", title: "Create posts", created_at: iso(NOW - 2 * DAY) }]),
    actions: async () => [{ id: 1, staff_email: "vin@morningtelos.com", action: "extend_trial", details: { days: 3 }, created_at: iso(NOW) }],
    setPlan: rec("setPlan", { from: {}, to: {} }),
    extendTrial: rec("extendTrial", { days: 7 }),
    retryJob: rec("retryJob", { job: 1 }),
    ...o,
  };
  return { d, calls };
}

test("staffRoute: anyone who isn't staff gets 404 from every action, and nothing is read or changed", async () => {
  for (const action of ["me", "overview", "workspace", "plan", "trial", "retry", "nope"]) {
    const touched: string[] = [];
    const spy = new Proxy({} as StaffDeps, {
      get: (_t, k) => (k === "staff" ? async () => null : k === "now" ? () => NOW : (...a: unknown[]) => (touched.push(String(k)), Promise.resolve(a))),
    });
    const out = await staffRoute(action, { workspaceId: WS, plan: "pro", days: 7, jobId: 1 }, spy);
    assert.equal(out.status, 404, action);
    assert.deepEqual(out.body, { error: STAFF_MESSAGES.notFound });
    assert.deepEqual(touched, [], `${action} touched ${touched}`);
  }
});

test("staffRoute: an unknown action is 404 for staff too", async () => {
  const { d } = deps();
  assert.equal((await staffRoute("delete_everything", {}, d)).status, 404);
  assert.equal((await staffRoute("__proto__", {}, d)).status, 404);
});

test("staffRoute me and overview: the strip and every workspace, searched", async () => {
  const { d } = deps();
  assert.deepEqual((await staffRoute("me", {}, d)).body, { staff: true });
  let since = "";
  const out = await staffRoute("overview", {}, { ...d, workspaces: async (s) => ((since = s), d.workspaces(s)) });
  assert.equal(out.status, 200);
  assert.equal(since, "2026-11-01T00:00:00.000Z");
  const body = out.body as { summary: { workspaces: number; failedJobs: number; aiMonth: number; byPlan: Record<string, number> }; workspaces: { name: string }[] };
  assert.equal(body.summary.workspaces, 2);
  assert.equal(body.summary.failedJobs, 1);
  assert.equal(body.summary.aiMonth, 3.5);
  assert.equal(body.summary.byPlan.pro, 1);
  assert.equal(body.workspaces.length, 2);
  const found = (await staffRoute("overview", { q: "plumb" }, d)).body as typeof body;
  assert.deepEqual(found.workspaces.map((w) => w.name), ["Bo's Plumbing"]);
  // The strip always counts every workspace, whatever the search.
  assert.equal(found.summary.workspaces, 2);
});

test("staffRoute workspace: details, failed jobs only, approvals pending over a day", async () => {
  const { d, calls } = deps();
  const out = await staffRoute("workspace", { workspaceId: WS }, d);
  assert.equal(out.status, 200);
  const body = out.body as { workspace: { id: string }; failedJobs: { id: number }[]; staleApprovals: unknown[]; services: unknown[]; actions: { line: string }[] };
  assert.equal(body.workspace.id, WS);
  assert.deepEqual(body.failedJobs.map((j) => j.id), [1]);
  assert.equal(body.staleApprovals.length, 1);
  assert.equal(body.services.length, 1);
  assert.equal(body.actions[0].line, "Trial extended by 3 days");
  assert.deepEqual(calls.find((c) => c.fn === "pendingBefore")?.args, [WS, iso(NOW - DAY)]);
});

test("staffRoute: a missing or malformed workspace id is 404, and nothing changes", async () => {
  const { d, calls } = deps();
  for (const workspaceId of [undefined, "", "not-a-uuid", "11111111-2222-4333-8444-999999999999"]) {
    for (const action of ["workspace", "plan", "trial", "retry"]) {
      const out = await staffRoute(action, { workspaceId, plan: "pro", days: 7, jobId: 1 }, d);
      assert.equal(out.status, 404, `${action} ${workspaceId}`);
      assert.equal(out.body.error, STAFF_MESSAGES.noWorkspace);
    }
  }
  assert.deepEqual(calls.filter((c) => ["setPlan", "extendTrial", "retryJob"].includes(c.fn)), []);
});

test("staffRoute plan: known plans only, not the same one again, saved with the right status as the staff member", async () => {
  const { d, calls } = deps();
  for (const plan of [undefined, "", "expired", "enterprise", "PRO"]) {
    const out = await staffRoute("plan", { workspaceId: WS, plan }, d);
    assert.equal(out.status, 400);
    assert.equal(out.body.error, STAFF_MESSAGES.pickPlan);
  }
  const same = await staffRoute("plan", { workspaceId: WS, plan: "trial" }, d);
  assert.equal(same.status, 400);
  assert.equal(same.body.error, STAFF_MESSAGES.samePlan);
  assert.equal(calls.length, 0);
  const ok = await staffRoute("plan", { workspaceId: WS, plan: "internal" }, d);
  assert.equal(ok.status, 200);
  assert.deepEqual(calls[0], { fn: "setPlan", args: [{ userId: "staff1", email: "vin@morningtelos.com" }, WS, { plan: "internal", status: "active" }] });
  // A canceled starter set back to starter is a real change: its status becomes active.
  const { d: d2, calls: c2 } = deps({ workspaces: async () => [row({ plan: "starter", status: "canceled" })] });
  assert.equal((await staffRoute("plan", { workspaceId: WS, plan: "starter" }, d2)).status, 200);
  assert.deepEqual(c2[0].args[2], { plan: "starter", status: "active" });
  // The workspace went away between the read and the change.
  const { d: d3 } = deps({ setPlan: async () => null });
  assert.equal((await staffRoute("plan", { workspaceId: WS, plan: "pro" }, d3)).status, 404);
});

test("staffRoute trial: 1 to 90 whole days", async () => {
  const { d, calls } = deps();
  for (const days of [0, 91, "x", 2.5, undefined]) assert.equal((await staffRoute("trial", { workspaceId: WS, days }, d)).status, 400, String(days));
  assert.equal(calls.length, 0);
  const ok = await staffRoute("trial", { workspaceId: WS, days: "14" }, d);
  assert.equal(ok.status, 200);
  assert.deepEqual(calls[0].args.slice(1), [WS, 14]);
});

test("staffRoute retry: a failed job in that workspace only", async () => {
  const { d, calls } = deps();
  assert.equal((await staffRoute("retry", { workspaceId: WS, jobId: "x" }, d)).status, 404);
  assert.equal(calls.length, 0);
  const ok = await staffRoute("retry", { workspaceId: WS, jobId: 1 }, d);
  assert.equal(ok.status, 200);
  assert.deepEqual(calls[0].args.slice(1), [WS, 1]);
  const { d: d2 } = deps({ retryJob: async () => null });
  const gone = await staffRoute("retry", { workspaceId: WS, jobId: 2 }, d2);
  assert.equal(gone.status, 404);
  assert.equal(gone.body.error, STAFF_MESSAGES.noJob);
});
