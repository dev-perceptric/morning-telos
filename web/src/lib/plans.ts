// Every plan's price and AI allowance, in one place. Billing, the AI meter and the pricing page all read from here,
// so changing a plan is a change to this file only (and a run of scripts/stripe-setup.mjs for a new price).
// Shared by the server and the browser. Copied from Arrowsterr's plans.ts and Omniscient's planOf.

export type PlanId = "trial" | "starter" | "pro";
/** What a workspace has right now: a plan, or "expired" when the trial ended or the plan was canceled. */
export type EffectivePlan = PlanId | "expired";
export type Interval = "month";

export type Plan = {
  id: PlanId;
  name: string;
  price: number; // US dollars a month. 0 for the trial.
  aiAllowance: number; // US dollars of Claude a month, the most one workspace can spend on AI
};

export const TRIAL_DAYS = 14;

export const PLANS: Record<PlanId, Plan> = {
  // 14 days free, no card. Starts when the person signs up (trial_from_signup in schema.sql).
  trial: { id: "trial", name: "Free trial", price: 0, aiAllowance: 5 },
  starter: { id: "starter", name: "Starter", price: 49, aiAllowance: 12 },
  pro: { id: "pro", name: "Pro", price: 149, aiAllowance: 50 },
};

/** Plans sold by card. */
export type PaidPlan = Exclude<PlanId, "trial">;
export const PAID_PLANS: PaidPlan[] = ["starter", "pro"];
export const isPaidPlan = (p: unknown): p is PaidPlan => typeof p === "string" && (PAID_PLANS as string[]).includes(p);

/** The Stripe lookup key for a plan's price, like morningtelos_pro_month. Made by scripts/stripe-setup.mjs, never hard-coded ids. */
export const lookupKey = (plan: PaidPlan, interval: Interval = "month") => `morningtelos_${plan}_${interval}`;
/** What Stripe charges for each billing period, in cents. */
export const priceCents = (plan: PaidPlan) => Math.round(PLANS[plan].price * 100);
/** Which plan and interval a lookup key stands for. Keys from other products never match. */
export function planOfLookup(key: string | null | undefined): { plan: PaidPlan; interval: Interval } | null {
  const m = key?.match(/^morningtelos_(starter|pro)_(month)$/);
  return m ? { plan: m[1] as PaidPlan, interval: m[2] as Interval } : null;
}

/** Stripe statuses that mean the plan is paid for. Past due keeps the plan while Stripe retries the card. */
export const PAID_STATUSES = ["trialing", "active", "past_due"];

export type PlanFields = { plan?: string | null; status?: string | null; trial_ends_at?: string | null };
export type PlanState = {
  /** The plan in force. */
  plan: EffectivePlan;
  /** True during the free trial. */
  trial: boolean;
  /** Days left in the trial, 0 otherwise. */
  daysLeft: number;
  /** True when a subscription pays for the plan. */
  paid: boolean;
  /** Stripe's word for the subscription (active, past_due, canceled...), or trialing before any. */
  status: string | null;
  /** US dollars of AI the workspace may use this month. */
  aiAllowance: number;
};

/**
 * The plan a workspace is on right now. Same rule as effective_plan() in supabase/002_billing.sql
 * (tests/rls.test.ts checks they agree):
 *   a paid plan with a trialing, active or past_due subscription is that plan;
 *   otherwise the trial, while it lasts;
 *   otherwise expired (the trial ended, or the plan was canceled).
 */
export function effectivePlan(ws: PlanFields, now = Date.now()): PlanState {
  const status = ws.status ?? null;
  if (isPaidPlan(ws.plan) && status && PAID_STATUSES.includes(status)) {
    return { plan: ws.plan, trial: false, daysLeft: 0, paid: true, status, aiAllowance: PLANS[ws.plan].aiAllowance };
  }
  const ends = ws.trial_ends_at ? Date.parse(ws.trial_ends_at) : NaN;
  if (Number.isFinite(ends) && ends > now) {
    return { plan: "trial", trial: true, daysLeft: Math.ceil((ends - now) / 864e5), paid: false, status, aiAllowance: PLANS.trial.aiAllowance };
  }
  return { plan: "expired", trial: false, daysLeft: 0, paid: false, status, aiAllowance: 0 };
}
