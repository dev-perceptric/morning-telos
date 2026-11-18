// The billing routes: checkout, customer portal and the Stripe webhook. Stripe is a fake behind globalThis.fetch,
// and any other address fails the test, so nothing reaches the real Stripe or Supabase.
// Run with: node --conditions=react-server --test tests/server/*.test.ts (part of npm test).

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { register } from "node:module";
import { beforeEach, test } from "node:test";
import { fakeDb } from "./fakeDb.ts";
import { auth } from "./stubs/serverAuth.ts";

register("./tsResolve.mjs", import.meta.url);

// Fake keys, only for this test process.
process.env.STRIPE_SECRET_KEY = "sk_test_fake";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_fake";
process.env.APP_URL = "https://app.test";

const webhook = await import("../../src/app/api/billing/webhook/route.ts");
const checkout = await import("../../src/app/api/billing/checkout/route.ts");
const portal = await import("../../src/app/api/billing/portal/route.ts");
const { effectivePlan } = await import("../../src/lib/plans.ts");

// ─────────────── fake Stripe ───────────────

type Sub = {
  id: string;
  created: number;
  customer: string;
  status: string;
  schedule: string | null;
  metadata: Record<string, string>;
  items: { data: { id: string; price: { id: string; lookup_key: string | null }; current_period_start: number }[] };
};
const PRICES = [
  { id: "price_starter_live", lookup_key: "morningtelos_starter_month", unit_amount: 4900, recurring: { interval: "month" } },
  { id: "price_pro_live", lookup_key: "morningtelos_pro_month", unit_amount: 14900, recurring: { interval: "month" } },
];
const priceOf = (plan: string) => PRICES.find((p) => p.lookup_key === `morningtelos_${plan}_month`) ?? { id: "price_other", lookup_key: null };
const PERIOD = 1_790_000_000; // a period start, in Unix seconds
const subOf = (id: string, plan: string, o: Partial<Sub> = {}): Sub => ({
  id,
  created: 1_780_000_000,
  customer: "cus_1",
  status: "active",
  schedule: null,
  metadata: { workspace_id: "ws1" },
  items: { data: [{ id: `si_${id}`, price: priceOf(plan), current_period_start: PERIOD }] },
  ...o,
});

let subs: Map<string, Sub>;
let calls: { method: string; path: string; body: URLSearchParams }[];

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (url.hostname !== "api.stripe.com") throw new Error(`test tried to reach ${url.hostname}`);
  assert.equal(new Headers(init?.headers).get("authorization"), "Bearer sk_test_fake");
  const method = init?.method ?? "GET";
  const path = url.pathname.replace(/^\/v1\//, "");
  const body = method === "GET" ? url.searchParams : new URLSearchParams(String(init?.body ?? ""));
  calls.push({ method, path, body });
  const ok = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
  if (method === "GET" && path === "prices") return ok({ data: PRICES.filter((p) => p.lookup_key === body.get("lookup_keys[0]")) });
  const sub = path.match(/^subscriptions\/(\w+)$/);
  if (sub && method === "GET") return subs.has(sub[1]) ? ok(subs.get(sub[1])) : new Response(JSON.stringify({ error: { message: "No such subscription" } }), { status: 404 });
  if (sub && method === "POST") {
    const s = subs.get(sub[1])!;
    const price = PRICES.find((p) => p.id === body.get("items[0][price]"))!;
    const updated = { ...s, items: { data: [{ id: `si_${s.id}`, price, current_period_start: PERIOD }] } };
    subs.set(s.id, updated);
    return ok(updated);
  }
  if (path === "customers") return ok({ id: "cus_new" });
  if (path === "checkout/sessions") return ok({ url: "https://checkout.stripe.test/c/1" });
  if (path === "billing_portal/sessions") return ok({ url: "https://billing.stripe.test/p/1" });
  if (/^subscription_schedules\/\w+\/release$/.test(path)) return ok({});
  throw new Error(`fake Stripe has no ${method} ${path}`);
}) as typeof fetch;

// ─────────────── a fake database with one workspace ───────────────

let db: ReturnType<typeof fakeDb>;
const ws = () => db.tables.workspaces[0];

beforeEach(() => {
  subs = new Map();
  calls = [];
  db = fakeDb({ stripe_events: ["id"] });
  db.tables.workspaces = [
    { id: "ws1", name: "Ana's Bakery", plan: "trial", status: "trialing", trial_ends_at: new Date(Date.now() - 864e5).toISOString(), period_start: "2026-01-01T00:00:00.000Z", stripe_customer_id: null, stripe_subscription_id: null },
  ];
  auth.db = db;
  auth.roles = new Map([
    ["owner1:ws1", "owner"],
    ["admin1:ws1", "admin"],
  ]);
});

const sign = (raw: string, secret = "whsec_test_fake", t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex")}`;
function hook(event: unknown, signature?: string | null) {
  const raw = JSON.stringify(event);
  const headers: Record<string, string> = {};
  if (signature !== null) headers["stripe-signature"] = signature ?? sign(raw);
  return webhook.POST(new Request("https://app.test/api/billing/webhook", { method: "POST", body: raw, headers }));
}
const subEvent = (id: string, type: string, object: unknown) => ({ id, type, data: { object } });
const wsWrites = () => db.writes.filter((w) => w.table === "workspaces");

// ─────────────── webhook ───────────────

test("webhook: refuses a missing, wrong or old signature, and writes nothing", async () => {
  const e = subEvent("evt_sig", "customer.subscription.updated", subOf("sub_1", "pro"));
  const raw = JSON.stringify(e);
  assert.equal((await hook(e, null)).status, 400);
  assert.equal((await hook(e, sign(raw, "whsec_wrong"))).status, 400);
  assert.equal((await hook(e, sign(raw, "whsec_test_fake", Math.floor(Date.now() / 1000) - 3600))).status, 400);
  assert.equal((await hook(e, sign(JSON.stringify({ ...e, id: "evt_other" })))).status, 400);
  assert.equal(db.writes.length, 0);
  assert.equal(calls.length, 0);
});

test("webhook: re-reads the subscription, so an out-of-date event can't set the wrong plan", async () => {
  // The event still says Starter, but the customer has since moved to Pro.
  subs.set("sub_1", subOf("sub_1", "pro"));
  const res = await hook(subEvent("evt_1", "customer.subscription.updated", subOf("sub_1", "starter")));
  assert.equal(res.status, 200);
  assert.deepEqual(
    calls.map((c) => `${c.method} ${c.path}`),
    ["GET subscriptions/sub_1"],
  );
  assert.equal(ws().plan, "pro");
  assert.equal(ws().status, "active");
  assert.equal(ws().stripe_subscription_id, "sub_1");
  assert.equal(ws().stripe_customer_id, "cus_1");
  assert.equal(ws().period_start, new Date(PERIOD * 1000).toISOString());
  assert.equal(effectivePlan(ws() as never).plan, "pro");
});

test("webhook: ignores a repeated event id", async () => {
  subs.set("sub_1", subOf("sub_1", "starter"));
  const e = subEvent("evt_twice", "invoice.paid", { id: "in_1", subscription: "sub_1" });
  assert.equal((await hook(e)).status, 200);
  assert.equal(ws().plan, "starter");
  const writesAfterFirst = wsWrites().length;
  const callsAfterFirst = calls.length;
  // Stripe sends it again, after the plan changed some other way.
  ws().plan = "pro";
  const again = await hook(e);
  assert.equal(again.status, 200);
  assert.deepEqual(await again.json(), { received: true, duplicate: true });
  assert.equal(wsWrites().length, writesAfterFirst);
  assert.equal(calls.length, callsAfterFirst);
  assert.equal(ws().plan, "pro");
  assert.deepEqual(db.tables.stripe_events.map((r) => r.id), ["evt_twice"]);
});

test("webhook: an older subscription never undoes the current one", async () => {
  Object.assign(ws(), { plan: "pro", status: "active", stripe_customer_id: "cus_1", stripe_subscription_id: "sub_new" });
  subs.set("sub_new", subOf("sub_new", "pro", { created: 1_785_000_000 }));
  subs.set("sub_old", subOf("sub_old", "starter", { created: 1_780_000_000 }));
  assert.equal((await hook(subEvent("evt_old", "customer.subscription.updated", subs.get("sub_old")))).status, 200);
  assert.equal((await hook(subEvent("evt_old_gone", "customer.subscription.deleted", { ...subs.get("sub_old"), status: "canceled" }))).status, 200);
  assert.equal(wsWrites().length, 0);
  assert.deepEqual([ws().plan, ws().stripe_subscription_id], ["pro", "sub_new"]);
});

test("webhook: a canceled plan ends, and after the trial the workspace is expired", async () => {
  Object.assign(ws(), { plan: "pro", status: "active", stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1" });
  // A deleted subscription can't be read back, so the event's own copy is used.
  assert.equal((await hook(subEvent("evt_del", "customer.subscription.deleted", subOf("sub_1", "pro", { status: "canceled" })))).status, 200);
  assert.equal(calls.filter((c) => c.path === "subscriptions/sub_1").length, 0);
  assert.equal(ws().status, "canceled");
  assert.equal(ws().stripe_subscription_id, null);
  assert.equal(effectivePlan(ws() as never).plan, "expired");
});

test("webhook: a failed payment keeps the plan while Stripe retries", async () => {
  Object.assign(ws(), { plan: "starter", status: "active", stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1" });
  subs.set("sub_1", subOf("sub_1", "starter", { status: "past_due" }));
  const invoice = { id: "in_2", parent: { subscription_details: { subscription: "sub_1" } } };
  assert.equal((await hook(subEvent("evt_fail", "invoice.payment_failed", invoice))).status, 200);
  assert.equal(ws().status, "past_due");
  assert.equal(effectivePlan(ws() as never).plan, "starter");
});

test("webhook: checkout finds the workspace from the session when the subscription has no workspace id", async () => {
  ws().stripe_customer_id = "cus_1";
  subs.set("sub_1", subOf("sub_1", "starter", { metadata: {} }));
  const session = { id: "cs_1", mode: "subscription", subscription: "sub_1", customer: "cus_1", client_reference_id: "ws1" };
  assert.equal((await hook(subEvent("evt_cs", "checkout.session.completed", session))).status, 200);
  assert.deepEqual([ws().plan, ws().status, ws().stripe_subscription_id], ["starter", "active", "sub_1"]);
});

test("webhook: a price with no Morning Telos lookup key keeps the plan", async () => {
  subs.set("sub_1", subOf("sub_1", "other"));
  assert.equal((await hook(subEvent("evt_odd", "customer.subscription.created", subs.get("sub_1")))).status, 200);
  assert.equal(ws().plan, "trial");
});

test("webhook: never moves a subscription onto another customer's workspace", async () => {
  ws().stripe_customer_id = "cus_someone_else";
  subs.set("sub_1", subOf("sub_1", "pro"));
  assert.equal((await hook(subEvent("evt_x", "customer.subscription.created", subs.get("sub_1")))).status, 200);
  assert.equal(wsWrites().length, 0);
  assert.equal(ws().plan, "trial");
});

test("webhook: a failure answers 500 and removes the mark, so Stripe's retry runs it", async () => {
  subs.set("sub_1", subOf("sub_1", "pro"));
  const e = subEvent("evt_retry", "customer.subscription.updated", subs.get("sub_1"));
  db.failNext.set("workspaces", "database is down");
  const res = await hook(e);
  assert.equal(res.status, 500);
  assert.equal(db.tables.stripe_events.length, 0);
  assert.equal((await hook(e)).status, 200);
  assert.equal(ws().plan, "pro");
});

test("webhook: skips events it doesn't handle", async () => {
  const res = await hook(subEvent("evt_skip", "customer.created", { id: "cus_1" }));
  assert.equal(res.status, 200);
  assert.equal(db.writes.length, 0);
});

// ─────────────── checkout and portal ───────────────

const post = (route: { POST: (r: Request) => Promise<Response> }, user: string | null, body: unknown) =>
  route.POST(new Request("https://app.test/api/billing/x", { method: "POST", body: JSON.stringify(body), headers: user ? { authorization: `Bearer ${user}` } : {} }));

test("checkout: only the owner can pick a plan", async () => {
  assert.equal((await post(checkout, null, { workspaceId: "ws1", plan: "pro" })).status, 401);
  assert.equal((await post(checkout, "admin1", { workspaceId: "ws1", plan: "pro" })).status, 403);
  assert.equal((await post(checkout, "stranger", { workspaceId: "ws1", plan: "pro" })).status, 403);
  assert.equal((await post(checkout, "owner1", { workspaceId: "ws1", plan: "trial" })).status, 400);
  assert.equal((await post(checkout, "owner1", { workspaceId: "ws1", plan: "enterprise" })).status, 400);
  assert.equal(calls.length, 0);
  assert.equal(db.writes.length, 0);
});

test("checkout: finds the price by lookup key, makes the customer once and opens Checkout", async () => {
  const res = await post(checkout, "owner1", { workspaceId: "ws1", plan: "starter" });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { url: "https://checkout.stripe.test/c/1" });
  const lookup = calls.find((c) => c.path === "prices")!;
  assert.equal(lookup.body.get("lookup_keys[0]"), "morningtelos_starter_month");
  const customer = calls.find((c) => c.path === "customers")!;
  assert.equal(customer.body.get("metadata[workspace_id]"), "ws1");
  assert.equal(ws().stripe_customer_id, "cus_new");
  const session = calls.find((c) => c.path === "checkout/sessions")!.body;
  assert.equal(session.get("mode"), "subscription");
  assert.equal(session.get("customer"), "cus_new");
  assert.equal(session.get("client_reference_id"), "ws1");
  assert.equal(session.get("line_items[0][price]"), "price_starter_live");
  assert.equal(session.get("subscription_data[metadata][workspace_id]"), "ws1");
  assert.equal(session.get("success_url"), "https://app.test/billing?checkout=done");
  // The plan itself changes only when the webhook hears from Stripe.
  assert.equal(ws().plan, "trial");

  calls = [];
  assert.equal((await post(checkout, "owner1", { workspaceId: "ws1", plan: "pro" })).status, 200);
  assert.equal(calls.filter((c) => c.path === "customers").length, 0);
  assert.equal(calls.find((c) => c.path === "checkout/sessions")!.body.get("line_items[0][price]"), "price_pro_live");
});

test("checkout: with a live subscription, switches its price instead of making a second one", async () => {
  Object.assign(ws(), { plan: "starter", status: "active", stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1" });
  subs.set("sub_1", subOf("sub_1", "starter", { schedule: "sub_sched_1" }));
  const res = await post(checkout, "owner1", { workspaceId: "ws1", plan: "pro" });
  assert.deepEqual(await res.json(), { changed: true, plan: "pro" });
  assert.ok(calls.some((c) => c.path === "subscription_schedules/sub_sched_1/release"));
  const update = calls.find((c) => c.method === "POST" && c.path === "subscriptions/sub_1")!.body;
  assert.equal(update.get("items[0][price]"), "price_pro_live");
  assert.equal(update.get("proration_behavior"), "always_invoice");
  assert.equal(calls.filter((c) => c.path === "checkout/sessions").length, 0);
  assert.equal(ws().plan, "pro");
});

test("portal: only the owner, and only after a plan was picked", async () => {
  assert.equal((await post(portal, "admin1", { workspaceId: "ws1" })).status, 403);
  assert.equal((await post(portal, null, { workspaceId: "ws1" })).status, 401);
  const none = await post(portal, "owner1", { workspaceId: "ws1" });
  assert.equal(none.status, 400);
  assert.equal(calls.length, 0);
  ws().stripe_customer_id = "cus_1";
  const res = await post(portal, "owner1", { workspaceId: "ws1" });
  assert.deepEqual(await res.json(), { url: "https://billing.stripe.test/p/1" });
  const session = calls.find((c) => c.path === "billing_portal/sessions")!.body;
  assert.equal(session.get("customer"), "cus_1");
  assert.equal(session.get("return_url"), "https://app.test/billing");
});

// ─────────────── usage ───────────────

const usage = await import("../../src/app/api/billing/usage/route.ts");

test("usage: anyone in the workspace sees this period's AI use, never the Stripe ids", async () => {
  auth.roles.set("viewer1:ws1", "viewer");
  const asked: Record<string, unknown>[] = [];
  db.rpcs.ai_spend = (args) => (asked.push(args), 1.234);
  Object.assign(ws(), { trial_ends_at: new Date(Date.now() + 10 * 864e5).toISOString(), stripe_customer_id: "cus_1" });
  const res = await post(usage, "viewer1", { workspaceId: "ws1" });
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.equal(out.plan, "trial");
  assert.equal(out.used, 1.23);
  assert.equal(out.allowance, 5);
  assert.equal(out.percent, 25);
  assert.equal(out.hasBilling, true);
  assert.equal(JSON.stringify(out).includes("cus_1"), false);
  assert.equal(asked[0].p_ws, "ws1");
  assert.equal(db.writes.length, 0);
  assert.equal(calls.length, 0);
});

test("usage: strangers and signed-out people get nothing; the internal plan has no meter", async () => {
  db.rpcs.ai_spend = () => 3;
  assert.equal((await post(usage, null, { workspaceId: "ws1" })).status, 401);
  assert.equal((await post(usage, "stranger", { workspaceId: "ws1" })).status, 403);
  Object.assign(ws(), { plan: "internal" });
  const out = await (await post(usage, "owner1", { workspaceId: "ws1" })).json();
  assert.equal(out.allowance, null);
  assert.equal(out.percent, 0);
});
