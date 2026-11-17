// Cancel and delete end to end: POST /api/workspace/delete, the Stripe webhook and the worker, with a fake database,
// a fake Stripe and fake partner APIs behind globalThis.fetch. Any other address fails the test.
// Run with: node --conditions=react-server --test tests/server/*.test.ts (part of npm test).

import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { register } from "node:module";
import { beforeEach, test } from "node:test";
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

const del = await import("../../src/app/api/workspace/delete/route.ts");
const webhook = await import("../../src/app/api/billing/webhook/route.ts");
const worker = await import("../../src/app/api/worker/route.ts");

const WS = "11111111-2222-4333-8444-777777777777";
const DAY = 86_400_000;

// ─────────────── fake partners and Stripe ───────────────

let partnerCalls: string[];
/** Hosts that answer 503 to everything. */
let down: Set<string>;
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
