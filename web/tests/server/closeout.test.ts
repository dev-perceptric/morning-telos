// Cancel and delete end to end: POST /api/workspace/delete, the Stripe webhook and the worker, with a fake database,
// a fake Stripe and fake partner APIs behind globalThis.fetch. Any other address fails the test.
// Run with: node --conditions=react-server --test tests/server/*.test.ts (part of npm test).

import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { register } from "node:module";
import { beforeEach, describe, test } from "node:test";
import { fakeDb } from "./fakeDb.ts";
import { auth } from "./stubs/serverAuth.ts";

register("./tsResolve.mjs", import.meta.url);

// Fake settings, only for this test process.
const CRON = "test-cron-secret-456";
process.env.CRON_SECRET = CRON;
process.env.STRIPE_SECRET_KEY = "sk_test_fake";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_fake";
process.env.ARROWSTERR_PARTNER_URL = "https://aw.test";
process.env.ARROWSTERR_PARTNER_KEY = "aw_partner_test";
process.env.CAPYBAROAR_PARTNER_URL = "https://cb.test";
process.env.CAPYBAROAR_PARTNER_KEY = "cb_partner_test";
process.env.SEALING_KEYS = `t1:${randomBytes(32).toString("base64")}`;

const { trialOver } = await import("../../src/lib/closeout.ts");
type PlanFields = import("../../src/lib/plans.ts").PlanFields;
const del = await import("../../src/app/api/workspace/delete/route.ts");
const webhook = await import("../../src/app/api/billing/webhook/route.ts");
const worker = await import("../../src/app/api/worker/route.ts");

const WS = "11111111-2222-4333-8444-777777777777";
const DAY = 86_400_000;

// ─────────────── fake partners and Stripe ───────────────

let partnerCalls: string[];
/** Hosts that answer 503 to everything. */
let down: Set<string>;
/** Brands whose calls answer 503, for one workspace's outage. */
let downBrands: Set<string>;
let brands: Set<string>;
let subs: Map<string, unknown>;

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  const method = init?.method ?? "GET";
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
  if (url.hostname === "api.stripe.com") {
    const m = url.pathname.match(/^\/v1\/subscriptions\/(\w+)$/);
    if (m && method === "GET" && subs.has(m[1])) return json(200, subs.get(m[1]));
    throw new Error(`fake Stripe has no ${method} ${url.pathname}`);
  }
  if (url.hostname !== "aw.test" && url.hostname !== "cb.test") throw new Error(`test tried to reach ${url.hostname}`);
  partnerCalls.push(`${method} ${url.hostname}${url.pathname}`);
  if (down.has(url.hostname)) return json(503, { error: { code: "unavailable", message: "Down." } });
  const p = url.pathname.match(/^\/api\/partner\/brands(?:\/([^/]+))?(\/keys)?$/);
  if (!p) return json(404, { error: { code: "not_found", message: "No route." } });
  const [, id, keys] = p;
  if (id && downBrands.has(id)) return json(503, { error: { code: "unavailable", message: "Down." } });
  if (method === "POST" && !id) {
    const body = JSON.parse(String(init?.body));
    const bid = `${url.hostname}-brand`;
    const had = brands.has(bid);
    brands.add(bid);
    return json(had ? 200 : 201, { id: bid, ...body });
  }
  if (!brands.has(id)) return json(404, { error: { code: "not_found", message: "No such brand." } });
  if (keys && method === "POST") return json(201, { key: `${id}-key-${partnerCalls.length}`, prefix: `${id}-k` });
  if (keys && method === "DELETE") return new Response(null, { status: 204 });
  if (!keys && method === "DELETE") {
    brands.delete(id);
    return new Response(null, { status: 204 });
  }
  return json(404, { error: { code: "not_found", message: "No route." } });
}) as typeof fetch;

// ─────────────── a fake database with one workspace and both brands ready ───────────────

let db: ReturnType<typeof fakeDb>;

beforeEach(() => {
  partnerCalls = [];
  down = new Set();
  downBrands = new Set();
  brands = new Set(["aw.test-brand", "cb.test-brand"]);
  subs = new Map();
  db = fakeDb({ stripe_events: ["id"] }, { autoId: ["jobs"] });
  db.tables.workspaces = [
    { id: WS, name: "Ana's Bakery", website: "anasbakery.com", plan: "pro", status: "active", trial_ends_at: new Date(Date.now() - 30 * DAY).toISOString(), stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1" },
  ];
  db.tables.services = [
    { workspace_id: WS, product: "arrowsterr", status: "ready", brand_id: "aw.test-brand", sealed_key: "sealed-a", key_prefix: "aw_brand_a" },
    { workspace_id: WS, product: "capybaroar", status: "ready", brand_id: "cb.test-brand", sealed_key: "sealed-c", key_prefix: "cbr_brand_c" },
  ];
  db.tables.jobs = [];
  // The worker claims every due job that has tries left, the way claim_jobs does.
  db.rpcs.claim_jobs = () => {
    const now = new Date().toISOString();
    const due = db.tables.jobs.filter((j) => !j.done_at && String(j.run_at) <= now && Number(j.attempts ?? 0) < Number(j.max_attempts ?? 5));
    for (const j of due) j.attempts = Number(j.attempts ?? 0) + 1;
    return due.map((j) => ({ max_attempts: 5, ...j }));
  };
  // supabase/010_expire_trials.sql. Today's daily job counts as queued already, so the tests above see only their own
  // jobs; the trial tests below queue it for real (queueDaily).
  db.rpcs.queue_daily_jobs = () => 0;
  db.rpcs.expired_workspaces = ({ n }) =>
    db.tables.workspaces
      .filter((w) => trialOver(w as PlanFields))
      .filter((w) => db.tables.services.some((s) => s.workspace_id === w.id && ["pending", "waiting", "ready", "failed"].includes(String(s.status))))
      .map((w) => w.id)
      .slice(0, Number(n));
  auth.db = db;
  auth.roles = new Map([[`owner1:${WS}`, "owner"]]);
  auth.emails = new Map();
});

const svc = (product: string) => db.tables.services.find((s) => s.product === product);
const jobsOf = (kind: string) => db.tables.jobs.filter((j) => j.kind === kind);
const pendingKinds = () => db.tables.jobs.filter((j) => !j.done_at).map((j) => `${j.kind} ${(j.payload as { product?: string }).product ?? ""}`.trim());
const tick = async () => (await worker.POST(new Request("https://app.test/api/worker", { method: "POST", headers: { Authorization: `Bearer ${CRON}` } }))).json();
/** Makes waiting jobs due now, as if their time had come. */
const timePasses = () => db.tables.jobs.forEach((j) => !j.done_at && (j.run_at = new Date(Date.now() - 1000).toISOString()));

const deleteWs = () =>
  del.POST(new Request("https://app.test/api/workspace/delete", { method: "POST", headers: { Authorization: "Bearer owner1" }, body: JSON.stringify({ workspaceId: WS, confirm: "Ana's Bakery" }) }));

const sign = (raw: string, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${createHmac("sha256", "whsec_test_fake").update(`${t}.${raw}`).digest("hex")}`;
function stripe(id: string, type: string, object: unknown) {
  const raw = JSON.stringify({ id, type, data: { object } });
  return webhook.POST(new Request("https://app.test/api/billing/webhook", { method: "POST", body: raw, headers: { "stripe-signature": sign(raw) } }));
}
const sub = (id: string, status: string, created = 1_780_000_000) => ({
  id,
  created,
  customer: "cus_1",
  status,
  metadata: { workspace_id: WS },
  items: { data: [{ id: `si_${id}`, price: { id: "price_pro", lookup_key: "morningtelos_pro_month" }, current_period_start: 1_790_000_000 }] },
});

// ─────────────── delete ───────────────

test("delete: revokes both brands' keys at once, queues removal in 30 days, then deletes the workspace", async () => {
  const before = Date.now();
  const res = await deleteWs();
  assert.equal(res.status, 200);
  assert.deepEqual(partnerCalls, ["DELETE aw.test/api/partner/brands/aw.test-brand/keys", "DELETE cb.test/api/partner/brands/cb.test-brand/keys"]);
  assert.deepEqual(db.tables.workspaces, []);
  const removes = jobsOf("remove_brand");
  assert.deepEqual(removes.map((j) => j.payload), [
    { product: "arrowsterr", brand_id: "aw.test-brand", workspace_id: WS },
    { product: "capybaroar", brand_id: "cb.test-brand", workspace_id: WS },
  ]);
  for (const j of removes) {
    const wait = Date.parse(String(j.run_at)) - before;
    assert.ok(wait >= 30 * DAY && wait < 30 * DAY + 60_000, `run_at is 30 days out (${wait})`);
  }
  assert.deepEqual(jobsOf("revoke_keys"), []);
  assert.deepEqual([svc("arrowsterr")!.status, svc("arrowsterr")!.sealed_key], ["removing", null]);
});

test("delete: a partner outage doesn't block the delete; the revoke is queued and the worker retries it", async () => {
  down.add("cb.test");
  const res = await deleteWs();
  assert.equal(res.status, 200);
  assert.deepEqual(db.tables.workspaces, []);
  assert.deepEqual(pendingKinds(), ["remove_brand arrowsterr", "revoke_keys capybaroar", "remove_brand capybaroar"]);

  // The workspace's rows are gone (cascade), as in Postgres. The jobs live on with their payload.
  db.tables.services = [];
  for (const j of db.tables.jobs) j.workspace_id = null;
  assert.deepEqual(await tick(), { claimed: 1, done: 0, retry: 1, failed: 0 });
  down.clear();
  timePasses();
  // Now both removals are "due" too: the revoke and both removes finish.
  assert.deepEqual(await tick(), { claimed: 3, done: 3, retry: 0, failed: 0 });
  assert.deepEqual([...brands], []);
  assert.deepEqual(pendingKinds(), []);
});

test("delete: remove_brand after 30 days treats an already-gone brand (404) as done", async () => {
  await deleteWs();
  db.tables.services = [];
  brands.delete("aw.test-brand"); // someone removed it in Arrowsterr already
  timePasses();
  assert.deepEqual(await tick(), { claimed: 2, done: 2, retry: 0, failed: 0 });
  assert.ok(partnerCalls.includes("DELETE aw.test/api/partner/brands/aw.test-brand"));
});

// ─────────────── cancel and come back ───────────────

test("cancel: a subscription that ends revokes keys and queues removal; coming back cancels it and makes fresh keys", async () => {
  const res = await stripe("evt_del", "customer.subscription.deleted", sub("sub_1", "canceled"));
  assert.equal(res.status, 200);
  assert.equal(db.tables.workspaces[0].status, "canceled");
  assert.deepEqual(partnerCalls, ["DELETE aw.test/api/partner/brands/aw.test-brand/keys", "DELETE cb.test/api/partner/brands/cb.test-brand/keys"]);
  assert.deepEqual([svc("arrowsterr")!.status, svc("capybaroar")!.status], ["removing", "removing"]);
  assert.deepEqual(pendingKinds(), ["remove_brand arrowsterr", "remove_brand capybaroar"]);

  // Back 10 days later with a new subscription.
  partnerCalls = [];
  subs.set("sub_2", sub("sub_2", "active", 1_790_000_000));
  assert.equal((await stripe("evt_back", "customer.subscription.created", sub("sub_2", "active", 1_790_000_000))).status, 200);
  assert.equal(db.tables.workspaces[0].status, "active");
  assert.deepEqual(pendingKinds(), ["provision"]);
  for (const j of jobsOf("remove_brand")) assert.equal(j.last_error, "Canceled: the subscription came back.");
  assert.deepEqual([svc("arrowsterr")!.status, svc("capybaroar")!.status], ["pending", "pending"]);

  assert.deepEqual(await tick(), { claimed: 1, done: 1, retry: 0, failed: 0 });
  for (const p of ["arrowsterr", "capybaroar"]) {
    assert.equal(svc(p)!.status, "ready");
    assert.ok(svc(p)!.sealed_key);
  }
  assert.equal(svc("arrowsterr")!.brand_id, "aw.test-brand", "the same brand");
  assert.ok(partnerCalls.includes("POST aw.test/api/partner/brands/aw.test-brand/keys"), "a fresh key");
  // The old removal never runs.
  timePasses();
  assert.deepEqual(await tick(), { claimed: 0, done: 0, retry: 0, failed: 0 });
  assert.equal(brands.size, 2);
});

test("cancel: after 30 days with no comeback the brands are removed and the services say removed", async () => {
  await stripe("evt_del2", "customer.subscription.deleted", sub("sub_1", "canceled"));
  timePasses();
  assert.deepEqual(await tick(), { claimed: 2, done: 2, retry: 0, failed: 0 });
  assert.deepEqual([svc("arrowsterr")!.status, svc("capybaroar")!.status], ["removed", "removed"]);
  assert.deepEqual([...brands], []);
});

test("a payment that is only past due closes nothing", async () => {
  subs.set("sub_1", sub("sub_1", "past_due"));
  await stripe("evt_pd", "customer.subscription.updated", sub("sub_1", "past_due"));
  assert.deepEqual(partnerCalls, []);
  assert.equal(svc("arrowsterr")!.status, "ready");
  assert.deepEqual(db.tables.jobs, []);
});

// ─────────────── a free trial that ends without a plan (Stripe sends nothing) ───────────────

/** Ana's workspace on the free trial that ended (or ends) `days` from now, with no subscription. */
function onTrial(days: number) {
  Object.assign(db.tables.workspaces[0], { plan: "trial", status: "trialing", trial_ends_at: new Date(Date.now() + days * DAY).toISOString(), stripe_customer_id: null, stripe_subscription_id: null });
}
const expireJobs = () => jobsOf("expire_trials");

/** One daily job per kind and UTC day, like queue_daily_jobs() in supabase/010_expire_trials.sql. */
function queueDaily() {
  const day = new Date().toISOString().slice(0, 10);
  if (db.tables.jobs.some((j) => j.kind === "expire_trials" && (j.payload as { day?: string }).day === day)) return 0;
  db.tables.jobs.push({ id: 900 + db.tables.jobs.length, kind: "expire_trials", workspace_id: null, payload: { day }, run_at: new Date().toISOString(), attempts: 0, max_attempts: 20 });
  return 1;
}

describe("the daily expire_trials job", () => {
  beforeEach(() => {
    db.rpcs.queue_daily_jobs = queueDaily;
  });

  test("trial over with no plan: the daily job revokes keys, marks services removing and queues removal in 30 days", async () => {
    onTrial(-1);
    const before = Date.now();
    assert.deepEqual(await tick(), { claimed: 1, done: 1, retry: 0, failed: 0 });
    assert.equal(expireJobs().length, 1);
    assert.ok(expireJobs()[0].done_at);
    assert.deepEqual(partnerCalls, ["DELETE aw.test/api/partner/brands/aw.test-brand/keys", "DELETE cb.test/api/partner/brands/cb.test-brand/keys"]);
    for (const p of ["arrowsterr", "capybaroar"]) assert.deepEqual([svc(p)!.status, svc(p)!.sealed_key, svc(p)!.key_prefix], ["removing", null, null]);
    assert.deepEqual(pendingKinds(), ["remove_brand arrowsterr", "remove_brand capybaroar"]);
    for (const j of jobsOf("remove_brand")) {
      const wait = Date.parse(String(j.run_at)) - before;
      assert.ok(wait >= 30 * DAY && wait < 30 * DAY + 60_000, `run_at is 30 days out (${wait})`);
    }
    assert.deepEqual(jobsOf("revoke_keys"), []);
  });

  test("trial over: services with no brand yet (pending, waiting) are marked removed with no partner call", async () => {
    onTrial(-2);
    Object.assign(svc("arrowsterr")!, { status: "waiting", brand_id: null, sealed_key: null, key_prefix: null });
    Object.assign(svc("capybaroar")!, { status: "pending", brand_id: null, sealed_key: null, key_prefix: null });
    assert.deepEqual(await tick(), { claimed: 1, done: 1, retry: 0, failed: 0 });
    assert.deepEqual(partnerCalls, []);
    assert.deepEqual([svc("arrowsterr")!.status, svc("capybaroar")!.status], ["removed", "removed"]);
    assert.deepEqual(pendingKinds(), []);
  });

  for (const c of [
    { name: "a trial that is still running", set: () => onTrial(3) },
    { name: "a paid plan that is active", set: () => Object.assign(db.tables.workspaces[0], { plan: "pro", status: "active" }) },
    { name: "a paid plan that is past due", set: () => Object.assign(db.tables.workspaces[0], { plan: "starter", status: "past_due" }) },
  ]) {
    test(`the daily job leaves ${c.name} alone`, async () => {
      c.set();
      assert.deepEqual(await tick(), { claimed: 1, done: 1, retry: 0, failed: 0 });
      assert.deepEqual(partnerCalls, []);
      assert.deepEqual([svc("arrowsterr")!.status, svc("capybaroar")!.status], ["ready", "ready"]);
      assert.deepEqual(pendingKinds(), []);
    });
  }

  test("the daily job leaves a workspace that is already removing alone", async () => {
    onTrial(-20);
    for (const p of ["arrowsterr", "capybaroar"]) Object.assign(svc(p)!, { status: p === "arrowsterr" ? "removing" : "removed", sealed_key: null });
    const writes = db.writes.length;
    assert.deepEqual(await tick(), { claimed: 1, done: 1, retry: 0, failed: 0 });
    assert.deepEqual(partnerCalls, []);
    assert.deepEqual(pendingKinds(), []);
    // Only the daily job's own row changed.
    assert.deepEqual(db.writes.slice(writes).map((w) => w.table), ["jobs"]);
  });

  test("one workspace's partner outage doesn't stop the others; its revoke is queued and retried", async () => {
    const WS2 = "11111111-2222-4333-8444-888888888888";
    onTrial(-1);
    db.tables.workspaces.push({ ...db.tables.workspaces[0], id: WS2, name: "Bo's Garage" });
    db.tables.services.push(
      { workspace_id: WS2, product: "arrowsterr", status: "ready", brand_id: "aw-2", sealed_key: "s", key_prefix: "p" },
      { workspace_id: WS2, product: "capybaroar", status: "ready", brand_id: "cb-2", sealed_key: "s", key_prefix: "p" },
    );
    brands.add("aw-2").add("cb-2");
    downBrands.add("cb.test-brand"); // Capybaroar is down for Ana's brand only
    assert.deepEqual(await tick(), { claimed: 1, done: 1, retry: 0, failed: 0 });
    const of = (ws: string) => db.tables.services.filter((s) => s.workspace_id === ws).map((s) => s.status);
    assert.deepEqual(of(WS), ["removing", "removing"]);
    assert.deepEqual(of(WS2), ["removing", "removing"]);
    assert.ok(partnerCalls.includes("DELETE aw.test/api/partner/brands/aw-2/keys"));
    assert.ok(partnerCalls.includes("DELETE cb.test/api/partner/brands/cb-2/keys"));
    const revokes = jobsOf("revoke_keys");
    assert.deepEqual(revokes.map((j) => j.payload), [{ product: "capybaroar", brand_id: "cb.test-brand", workspace_id: WS }]);
    assert.equal(jobsOf("remove_brand").length, 4);
    // Capybaroar comes back: the queued revoke goes through on the next tick.
    downBrands.clear();
    assert.deepEqual(await tick(), { claimed: 1, done: 1, retry: 0, failed: 0 });
    assert.ok(revokes[0].done_at);
  });

  test("only one expire_trials job a day, however often the worker runs", async () => {
    onTrial(-1);
    for (let i = 0; i < 5; i++) await tick();
    assert.equal(expireJobs().length, 1);
    assert.equal(partnerCalls.filter((c) => c.endsWith("/keys")).length, 2, "each key revoked once");
    // A new UTC day queues the next one.
    const day = (expireJobs()[0].payload as { day: string }).day;
    (expireJobs()[0].payload as { day: string }).day = "2000-01-01";
    await tick();
    assert.deepEqual(expireJobs().map((j) => (j.payload as { day: string }).day), ["2000-01-01", day]);
  });

  test("a worker tick still runs due jobs when queue_daily_jobs is missing (010 not run yet)", async () => {
    delete db.rpcs.queue_daily_jobs;
    db.tables.jobs.push({ id: 1, kind: "revoke_keys", workspace_id: WS, payload: { product: "arrowsterr", brand_id: "aw.test-brand", workspace_id: WS }, run_at: new Date(0).toISOString(), attempts: 0, max_attempts: 12 });
    svc("arrowsterr")!.status = "removing";
    const logged: string[] = [];
    const was = console.error;
    console.error = (...a: unknown[]) => void logged.push(a.join(" "));
    try {
      assert.deepEqual(await tick(), { claimed: 1, done: 1, retry: 0, failed: 0 });
    } finally {
      console.error = was;
    }
    assert.ok(logged.includes("Run supabase/010_expire_trials.sql in Supabase."), logged.join("\n"));
  });

  test("subscribing after the trial closed brings the brands back with fresh keys", async () => {
    onTrial(-1);
    await tick();
    assert.deepEqual([svc("arrowsterr")!.status, svc("capybaroar")!.status], ["removing", "removing"]);

    partnerCalls = [];
    subs.set("sub_9", sub("sub_9", "active", 1_790_000_000));
    assert.equal((await stripe("evt_sub9", "checkout.session.completed", { id: "cs_9", object: "checkout.session", subscription: "sub_9", client_reference_id: WS, customer: "cus_1" })).status, 200);
    assert.equal(db.tables.workspaces[0].plan, "pro");
    assert.deepEqual(pendingKinds(), ["provision"]);
    for (const j of jobsOf("remove_brand")) assert.equal(j.last_error, "Canceled: the subscription came back.");

    assert.deepEqual(await tick(), { claimed: 1, done: 1, retry: 0, failed: 0 });
    for (const p of ["arrowsterr", "capybaroar"]) {
      assert.equal(svc(p)!.status, "ready");
      assert.ok(svc(p)!.sealed_key);
    }
    assert.equal(svc("arrowsterr")!.brand_id, "aw.test-brand", "the same brand");
    assert.ok(partnerCalls.includes("POST aw.test/api/partner/brands/aw.test-brand/keys"), "a fresh key");
    timePasses();
    assert.deepEqual(await tick(), { claimed: 0, done: 0, retry: 0, failed: 0 });
    assert.equal(brands.size, 2);
  });
});
