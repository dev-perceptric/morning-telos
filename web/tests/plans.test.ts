import assert from "node:assert/strict";
import test from "node:test";
import { PAID_PLANS, PLANS, TRIAL_DAYS, effectivePlan, isPaidPlan, lookupKey, planOfLookup, priceCents, questionLimit } from "../src/lib/plans.ts";

const now = Date.parse("2026-11-17T12:00:00Z");
const day = 864e5;
const at = (days: number) => new Date(now + days * day).toISOString();

test("prices and AI allowances match the plan", () => {
  assert.equal(TRIAL_DAYS, 14);
  assert.deepEqual(
    Object.values(PLANS).map((p) => [p.id, p.name, p.price, p.aiAllowance]),
    [
      ["trial", "Free trial", 0, 5],
      ["starter", "Starter", 49, 12],
      ["pro", "Pro", 149, 50],
      ["internal", "Internal", 0, 1_000_000],
    ],
  );
  assert.deepEqual(PAID_PLANS, ["starter", "pro"]);
  assert.equal(priceCents("starter"), 4900);
  assert.equal(priceCents("pro"), 14900);
});

test("lookup keys name the plan, and other products' keys never match", () => {
  assert.equal(lookupKey("pro"), "morningtelos_pro_month");
  assert.deepEqual(planOfLookup("morningtelos_starter_month"), { plan: "starter", interval: "month" });
  assert.equal(planOfLookup("morningtelos_trial_month"), null);
  assert.equal(planOfLookup("arrowsterr_v6_scale_month"), null);
  assert.equal(planOfLookup("omniscient_pro_month"), null);
  assert.equal(planOfLookup(null), null);
  assert.equal(isPaidPlan("pro"), true);
  assert.equal(isPaidPlan("trial"), false);
  assert.equal(isPaidPlan("__proto__"), false);
});

test("trial: a new workspace is on the trial with its days left and $5 of AI", () => {
  const s = effectivePlan({ plan: "trial", status: "trialing", trial_ends_at: at(9.2) }, now);
  assert.deepEqual(s, { plan: "trial", trial: true, daysLeft: 10, paid: false, status: "trialing", aiAllowance: 5 });
});

test("trial ended: expired, with no AI allowance", () => {
  const s = effectivePlan({ plan: "trial", status: "trialing", trial_ends_at: at(-1) }, now);
  assert.deepEqual([s.plan, s.trial, s.paid, s.aiAllowance], ["expired", false, false, 0]);
});

test("active: the paid plan wins over the trial", () => {
  const s = effectivePlan({ plan: "starter", status: "active", trial_ends_at: at(5) }, now);
  assert.deepEqual([s.plan, s.trial, s.paid, s.aiAllowance], ["starter", false, true, 12]);
  assert.equal(effectivePlan({ plan: "pro", status: "active", trial_ends_at: at(-30) }, now).aiAllowance, 50);
});

test("past due: keeps the plan while Stripe retries the card", () => {
  const s = effectivePlan({ plan: "pro", status: "past_due", trial_ends_at: at(-30) }, now);
  assert.deepEqual([s.plan, s.paid], ["pro", true]);
});

test("canceled: expired after the trial, back on the trial while it lasts", () => {
  assert.equal(effectivePlan({ plan: "pro", status: "canceled", trial_ends_at: at(-30) }, now).plan, "expired");
  assert.equal(effectivePlan({ plan: "pro", status: "canceled", trial_ends_at: at(2) }, now).plan, "trial");
  assert.equal(effectivePlan({ plan: "starter", status: "unpaid", trial_ends_at: at(-30) }, now).plan, "expired");
});

test("an unknown plan or missing fields never unlock a paid plan", () => {
  assert.equal(effectivePlan({ plan: "enterprise", status: "active", trial_ends_at: at(-1) }, now).plan, "expired");
  assert.equal(effectivePlan({}, now).plan, "expired");
  assert.equal(effectivePlan({ plan: "pro", status: null, trial_ends_at: null }, now).plan, "expired");
});

test("the internal plan is always in force, never expires and is never sold", async () => {
  const { effectivePlan, isPaidPlan, PLANS } = await import("../src/lib/plans.ts");
  const past = new Date(Date.now() - 864e5 * 30).toISOString();
  for (const status of ["active", "canceled", "trialing", null]) {
    const s = effectivePlan({ plan: "internal", status, trial_ends_at: past });
    assert.equal(s.plan, "internal");
    assert.equal(s.paid, true);
    assert.equal(s.aiAllowance, PLANS.internal.aiAllowance);
  }
  assert.equal(isPaidPlan("internal"), false);
});


test("questionLimit: the AI questions Artemis may track on each plan", () => {
  assert.deepEqual(["trial", "starter", "pro", "internal", "expired"].map((p) => questionLimit(p as Parameters<typeof questionLimit>[0])), [15, 15, 40, 500, 0]);
});
