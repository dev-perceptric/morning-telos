// POST /api/staff/<action> with a fake database. Who is signed in comes from the serverAuth stand-in, and STAFF_EMAILS
// is set for this test process only. Nothing reaches the real Supabase.
// Run with: node --conditions=react-server --test tests/server/*.test.ts (part of npm test).

import assert from "node:assert/strict";
import { register } from "node:module";
import { beforeEach, test } from "node:test";
import { fakeDb } from "./fakeDb.ts";
import { auth } from "./stubs/serverAuth.ts";

register("./tsResolve.mjs", import.meta.url);

process.env.STAFF_EMAILS = "Vin@MorningTelos.com, ops@morningtelos.com";

const route = await import("../../src/app/api/staff/[action]/route.ts");

globalThis.fetch = (async (input: string | URL | Request) => {
  throw new Error(`test tried to reach ${String(input)}`);
}) as typeof fetch;

const WS = "11111111-2222-4333-8444-555555555555";
const OTHER = "11111111-2222-4333-8444-666666666666";
const DAY = 864e5;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

let db: ReturnType<typeof fakeDb>;
let rpcCalls: { name: string; args: Record<string, unknown> }[];

const wsRow = (id: string, name: string, o: Record<string, unknown> = {}) => ({
  id,
  name,
  website: null,
  plan: "trial",
  status: "trialing",
  trial_ends_at: new Date(Date.now() + 2 * DAY).toISOString(),
  period_start: ago(3),
  stripe_subscription_id: null,
  created_at: ago(3),
  owner_email: `${name.toLowerCase().replace(/\W/g, "")}@example.com`,
  members: 1,
  ai_usd: "0.50",
  ...o,
});

beforeEach(() => {
  db = fakeDb({}, { autoId: ["staff_actions"] });
  rpcCalls = [];
  const all = [wsRow(WS, "Ana Bakery"), wsRow(OTHER, "Bo Plumbing", { plan: "pro", status: "active", ai_usd: 4 })];
  const track = (name: string, fn: (a: Record<string, unknown>) => unknown) => (db.rpcs[name] = (a) => (rpcCalls.push({ name, args: a }), fn(a)));
  track("staff_workspaces", (a) => all.filter((w) => !a.p_ws || w.id === a.p_ws));
  track("staff_ai_total", () => "4.50");
  track("staff_set_plan", (a) => ({ from: { plan: "trial", status: "trialing" }, to: { plan: a.p_plan, status: a.p_status } }));
  track("staff_extend_trial", (a) => ({ days: a.p_days }));
  track("staff_retry_job", (a) => (a.p_job === 1 && a.p_ws === WS ? { job: 1, kind: "provision" } : null));
  db.tables.jobs = [
    { id: 1, kind: "provision", workspace_id: WS, attempts: 5, max_attempts: 5, last_error: "Arrowsterr did not answer in time.", run_at: ago(0.5), created_at: ago(2), done_at: null },
    { id: 2, kind: "scan_website", workspace_id: WS, attempts: 1, max_attempts: 5, last_error: null, run_at: ago(0.1), created_at: ago(0.1), done_at: null },
    { id: 3, kind: "provision", workspace_id: OTHER, attempts: 5, max_attempts: 5, last_error: "Other customer's job", run_at: ago(0.2), created_at: ago(1), done_at: null },
    { id: 4, kind: "expire_trials", workspace_id: null, attempts: 20, max_attempts: 20, last_error: "old", run_at: ago(3), created_at: ago(3), done_at: null },
    { id: 5, kind: "provision", workspace_id: WS, attempts: 5, max_attempts: 5, last_error: null, run_at: ago(0.3), created_at: ago(1), done_at: ago(0.3) },
  ];
  db.tables.services = [
    { workspace_id: WS, product: "arrowsterr", status: "failed", brand_id: null, sealed_key: "SEALED", key_prefix: null, last_error: "Arrowsterr did not answer in time.", updated_at: ago(0.5) },
    { workspace_id: WS, product: "capybaroar", status: "ready", brand_id: "cb-1", sealed_key: "SEALED", key_prefix: "cbr_brand_ab", last_error: null, updated_at: ago(1) },
    { workspace_id: OTHER, product: "capybaroar", status: "ready", brand_id: "cb-2", sealed_key: "SEALED", key_prefix: "cbr_brand_cd", last_error: null, updated_at: ago(1) },
  ];
  db.tables.approvals = [
    { id: 10, workspace_id: WS, agent: "social", title: "Create posts", status: "pending", created_at: ago(2) },
    { id: 11, workspace_id: WS, agent: "social", title: "Fresh one", status: "pending", created_at: ago(0.1) },
    { id: 12, workspace_id: WS, agent: "seo", title: "Old but done", status: "done", created_at: ago(5) },
    { id: 13, workspace_id: OTHER, agent: "seo", title: "Other customer", status: "pending", created_at: ago(5) },
  ];
  db.tables.staff_actions = [
    { id: 1, staff_user_id: "s1", staff_email: "vin@morningtelos.com", workspace_id: WS, action: "extend_trial", details: { days: 3 }, created_at: ago(1) },
    { id: 2, staff_user_id: "s1", staff_email: "vin@morningtelos.com", workspace_id: OTHER, action: "set_plan", details: {}, created_at: ago(1) },
  ];
  auth.db = db;
  auth.emails = new Map([
    ["staff1", "vin@morningtelos.com"],
    ["owner1", "ana@example.com"],
    ["late1", "ops@morningtelos.com"],
  ]);
  auth.unconfirmed = new Set(["late1"]);
});

const call = async (action: string, body: Record<string, unknown> = {}, user: string | null = "staff1") => {
  const res = await route.POST(
    new Request(`https://app.test/api/staff/${action}`, { method: "POST", headers: { "Content-Type": "application/json", ...(user ? { Authorization: `Bearer ${user}` } : {}) }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ action }) },
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown>, cache: res.headers.get("cache-control") };
};

test("not signed in, not staff, or a staff email not confirmed yet: 404 from every route, and nothing is read", async () => {
  for (const user of [null, "owner1", "late1"]) {
    for (const action of ["me", "overview", "workspace", "plan", "trial", "retry", "nope"]) {
      const out = await call(action, { workspaceId: WS, plan: "pro", days: 7, jobId: 1 }, user);
      assert.equal(out.status, 404, `${user} ${action}`);
      assert.deepEqual(out.body, { error: "Not found." });
    }
  }
  assert.deepEqual(rpcCalls, []);
  assert.deepEqual(db.writes, []);
});

test("STAFF_EMAILS empty means nobody is staff", async () => {
  const before = process.env.STAFF_EMAILS;
  process.env.STAFF_EMAILS = "";
  try {
    assert.equal((await call("me")).status, 404);
  } finally {
    process.env.STAFF_EMAILS = before;
  }
});

test("staff: me says so; overview has the strip and every workspace, and is never cached", async () => {
  const me = await call("me");
  assert.equal(me.status, 200);
  assert.deepEqual(me.body, { staff: true });
  const out = await call("overview");
  assert.equal(out.status, 200);
  assert.equal(out.cache, "no-store");
  const summary = out.body.summary as Record<string, unknown>;
  assert.equal(summary.workspaces, 2);
  assert.equal(summary.aiMonth, 4.5);
  assert.equal(summary.trialsEnding, 1);
  // Failed in the last day: job 1 and the other customer's job 3. Job 4 failed 3 days ago, job 5 is done.
  assert.equal(summary.failedJobs, 2);
  assert.equal((out.body.workspaces as unknown[]).length, 2);
  const q = await call("overview", { q: "bo plumbing" });
  assert.deepEqual((q.body.workspaces as { name: string }[]).map((w) => w.name), ["Bo Plumbing"]);
  const ws = rpcCalls.find((c) => c.name === "staff_workspaces")!;
  assert.match(String(ws.args.p_since), /^\d{4}-\d{2}-01T00:00:00\.000Z$/);
});

test("workspace: only that workspace's services (never the sealed key), failed jobs and approvals pending over a day", async () => {
  const out = await call("workspace", { workspaceId: WS });
  assert.equal(out.status, 200);
  assert.equal((out.body.workspace as { name: string }).name, "Ana Bakery");
  const services = out.body.services as Record<string, unknown>[];
  assert.deepEqual(services.map((s) => s.product).sort(), ["arrowsterr", "capybaroar"]);
  for (const s of services) assert.ok(!("sealed_key" in s), "sealed key sent to the browser");
  assert.ok(!JSON.stringify(out.body).includes("SEALED"));
  assert.deepEqual((out.body.failedJobs as { id: number }[]).map((j) => j.id), [1]);
  assert.deepEqual((out.body.staleApprovals as { id: number }[]).map((a) => a.id), [10]);
  const actions = out.body.actions as { id: number; line: string }[];
  assert.deepEqual(actions.map((a) => a.id), [1]);
  assert.equal(actions[0].line, "Trial extended by 3 days");
  assert.ok(!JSON.stringify(out.body).includes("Other customer"));
});

test("workspace: unknown or malformed ids are 404", async () => {
  for (const workspaceId of [undefined, "nope", "11111111-2222-4333-8444-999999999999"]) {
    const out = await call("workspace", { workspaceId });
    assert.equal(out.status, 404);
    assert.equal(out.body.error, "That workspace was not found.");
  }
});

test("plan, trial and retry run their SQL function as the staff member", async () => {
  const plan = await call("plan", { workspaceId: WS, plan: "pro" });
  assert.equal(plan.status, 200);
  assert.deepEqual(rpcCalls.find((c) => c.name === "staff_set_plan")?.args, { p_staff: "staff1", p_email: "vin@morningtelos.com", p_ws: WS, p_plan: "pro", p_status: "active" });
  const trial = await call("trial", { workspaceId: WS, days: 7 });
  assert.equal(trial.status, 200);
  assert.deepEqual(rpcCalls.find((c) => c.name === "staff_extend_trial")?.args, { p_staff: "staff1", p_email: "vin@morningtelos.com", p_ws: WS, p_days: 7 });
  const retry = await call("retry", { workspaceId: WS, jobId: 1 });
  assert.equal(retry.status, 200);
  assert.deepEqual(rpcCalls.find((c) => c.name === "staff_retry_job")?.args, { p_staff: "staff1", p_email: "vin@morningtelos.com", p_ws: WS, p_job: 1 });
  // Another workspace's job, through this workspace: the SQL function finds nothing.
  const other = await call("retry", { workspaceId: WS, jobId: 3 });
  assert.equal(other.status, 404);
  // Bad input never reaches the database.
  const writes = () => rpcCalls.filter((c) => c.name === "staff_set_plan" || c.name === "staff_extend_trial").length;
  const n = writes();
  assert.equal((await call("plan", { workspaceId: WS, plan: "free" })).status, 400);
  assert.equal((await call("trial", { workspaceId: WS, days: 365 })).status, 400);
  assert.equal(writes(), n);
});

test("a database error is one short line, never the database's own message", async () => {
  db.rpcs.staff_workspaces = () => {
    throw new Error("relation staff_workspaces does not exist");
  };
  const out = await call("overview");
  assert.equal(out.status, 500);
  assert.deepEqual(out.body, { error: "Something went wrong. Try again." });
});

test("no server key: says what to set", async () => {
  auth.db = null;
  const out = await call("overview");
  assert.equal(out.status, 500);
  assert.match(String(out.body.error), /SUPABASE_SECRET_KEY/);
});
