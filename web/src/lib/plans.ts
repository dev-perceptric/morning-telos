// Every plan's price and AI allowance, in one place. Billing, the AI meter and the pricing page all read from here,
// so changing a plan is a change to this file only (and a run of scripts/stripe-setup.mjs for a new price).
// Shared by the server and the browser. Copied from Arrowsterr's plans.ts and Omniscient's planOf.

export type PlanId = "trial" | "starter" | "pro" | "internal";
/** What a workspace has right now: a plan, or "expired" when the trial ended or the plan was canceled. */
export type EffectivePlan = PlanId | "expired";
export type Interval = "month";

export type Plan = {
  id: PlanId;
  name: string;
  price: number; // US dollars a month. 0 for the trial.
  aiAllowance: number; // US dollars of Claude a month, the most one workspace can spend on AI
  // AI questions Artemis tracks in Arrowsterr. Each one is asked of every AI tool daily, about $0.27 a month (Arrowsterr's cost_ledger).
  aiQuestions: number;
};

export const TRIAL_DAYS = 14;

export const PLANS: Record<PlanId, Plan> = {
  // 14 days free, no card. Starts when the person signs up (trial_from_signup in schema.sql).
  trial: { id: "trial", name: "Free trial", price: 0, aiAllowance: 5, aiQuestions: 15 },
  starter: { id: "starter", name: "Starter", price: 49, aiAllowance: 12, aiQuestions: 15 },
  pro: { id: "pro", name: "Pro", price: 149, aiAllowance: 50, aiQuestions: 40 },
  // Our own workspaces. Never sold and never set by Stripe: staff set it in the database (015_internal_plan.sql).
  // The allowance is high enough to never stop the team.
  internal: { id: "internal", name: "Internal", price: 0, aiAllowance: 1_000_000, aiQuestions: 500 },
};

/** Plans sold by card. */
export type PaidPlan = Exclude<PlanId, "trial" | "internal">;
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
 *   the internal plan is always internal (our own workspaces, no subscription);
 *   a paid plan with a trialing, active or past_due subscription is that plan;
 *   otherwise the trial, while it lasts;
 *   otherwise expired (the trial ended, or the plan was canceled).
 */
export function effectivePlan(ws: PlanFields, now = Date.now()): PlanState {
  const status = ws.status ?? null;
  if (ws.plan === "internal") return { plan: "internal", trial: false, daysLeft: 0, paid: true, status, aiAllowance: PLANS.internal.aiAllowance };
  if (isPaidPlan(ws.plan) && status && PAID_STATUSES.includes(status)) {
    return { plan: ws.plan, trial: false, daysLeft: 0, paid: true, status, aiAllowance: PLANS[ws.plan].aiAllowance };
  }
  const ends = ws.trial_ends_at ? Date.parse(ws.trial_ends_at) : NaN;
  if (Number.isFinite(ends) && ends > now) {
    return { plan: "trial", trial: true, daysLeft: Math.ceil((ends - now) / 864e5), paid: false, status, aiAllowance: PLANS.trial.aiAllowance };
  }
  return { plan: "expired", trial: false, daysLeft: 0, paid: false, status, aiAllowance: 0 };
}

/** How many AI questions Artemis may track for a workspace on this plan. None once the plan has ended. */
export const questionLimit = (plan: EffectivePlan) => (plan === "expired" ? 0 : PLANS[plan].aiQuestions);
