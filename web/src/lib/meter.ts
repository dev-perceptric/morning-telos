// The AI meter: what each Claude call cost, and whether a workspace may start another turn.
// Pure, so the server and the tests share it. Every call's tokens and dollars are saved to ai_usage
// (supabase/011_ai_team.sql); staff read cost_by_workspace. Copied from Arrowsterr's meter.ts (CLAUDE price table,
// claudeCost) and the old app's costOf and canRun (app/lib/agents.js).

import { effectivePlan, TRIAL_DAYS, type PlanFields } from "./plans.ts";

/** US dollars per million tokens. */
export type Price = {
  input: number;
  output: number;
  /** Cache reads. */
  cacheRead: number;
  /** Cache writes with the 5-minute TTL (1.25x input). */
  cacheWrite: number;
  /** Long prompts priced higher: from `over` prompt tokens (input + cache), these rates apply instead. */
  long?: { over: number; input: number; output: number; cacheRead: number; cacheWrite: number };
};

// Prices from the claude-api skill's model table (cached 2026-10-06) and its prompt-caching notes:
// cache writes are 1.25x input for the 5-minute TTL; cache reads are $0.20 on Opus 5.5 and Sonnet 5.5.
export const PRICES: Record<string, Price> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  // $0.10 / $0.50 up to 100K prompt tokens, $0.50 / $2.50 above. Cache reads at 0.1x input: check.
  "claude-haiku-5-5": {
    input: 0.1,
    output: 0.5,
    cacheRead: 0.01, // check
    cacheWrite: 0.125,
    long: { over: 100_000, input: 0.5, output: 2.5, cacheRead: 0.05 /* check */, cacheWrite: 0.625 },
  },
  // Models a refused request can fall back to (fallbacks: "default"). Cache reads at 0.1x input: check.
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5 /* check */, cacheWrite: 6.25 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5 /* check */, cacheWrite: 6.25 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2 /* check */, cacheWrite: 2.5 },
};

/** A model we have no price for is counted at Opus 5 rates, so the allowance is never under-counted by much. */
export const UNKNOWN_PRICE: Price = PRICES["claude-opus-5"];

export type Tokens = { input: number; output: number; cacheRead: number; cacheWrite: number };

/** What one call cost, in US dollars, to the millionth. */
export function costOf(model: string, t: Tokens): number {
  const p = PRICES[model] ?? UNKNOWN_PRICE;
  const prompt = t.input + t.cacheRead + t.cacheWrite;
  const r = p.long && prompt > p.long.over ? p.long : p;
  const usd = (n(t.input) * r.input + n(t.output) * r.output + n(t.cacheRead) * r.cacheRead + n(t.cacheWrite) * r.cacheWrite) / 1e6;
  return Math.round(usd * 1e6) / 1e6;
}
const n = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0);

/** The token counts from an API response's usage. Missing fields count as 0. */
export function tokensOf(u: { input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null } | null | undefined): Tokens {
  return { input: u?.input_tokens ?? 0, output: u?.output_tokens ?? 0, cacheRead: u?.cache_read_input_tokens ?? 0, cacheWrite: u?.cache_creation_input_tokens ?? 0 };
}

// ─────────────── caps ───────────────

export type MeterWorkspace = PlanFields & { period_start?: string | null };

/** Stripe statuses that mean the plan was stopped, not just that the trial ran out. */
const STOPPED = ["canceled", "unpaid", "incomplete_expired", "paused"];
/** A paid period lasts a month. If the saved start is older than this (a missed webhook), count the last 31 days. */
const LONGEST_PERIOD_MS = 31 * 864e5;

/**
 * When this period's AI spend starts counting. The trial's allowance covers the whole trial. A paid plan's covers
 * the billing period that started at period_start (written by the Stripe webhook).
 */
export function spendWindowStart(ws: MeterWorkspace, now = Date.now()): string {
  const plan = effectivePlan(ws, now);
  if (plan.plan === "trial") {
    const ends = ws.trial_ends_at ? Date.parse(ws.trial_ends_at) : NaN;
    return new Date(Number.isFinite(ends) ? ends - TRIAL_DAYS * 864e5 : now - TRIAL_DAYS * 864e5).toISOString();
  }
  const start = ws.period_start ? Date.parse(ws.period_start) : NaN;
  const floor = now - LONGEST_PERIOD_MS;
  return new Date(Number.isFinite(start) && start > floor && start <= now ? start : floor).toISOString();
}

export type Blocked = { reason: "expired" | "allowance"; text: string };

/** What the team says when it can't start a turn. Plain words, shown in the chat. */
export const CAP_MESSAGES = {
  trialOver: "Your free trial has ended. Pick a plan to keep your team working.",
  stopped: "Your plan isn't active right now. Pick a plan to keep your team working.",
  trialAllowance: "Your team has used the AI allowance for the free trial. Pick a plan to keep your team working.",
  allowance: "Your team has used this month's AI allowance. Upgrade your plan for more, or wait for next month.",
  startingUp: "Your AI team is starting up. Please try again in a few minutes.",
} as const;

/**
 * Whether the workspace may start a turn. Null means yes. Checked before every turn:
 * the plan in force must not be expired, and this period's spend must be under the plan's allowance (plans.ts).
 */
export function aiBlock(ws: MeterWorkspace, spentUsd: number, now = Date.now()): Blocked | null {
  const plan = effectivePlan(ws, now);
  if (plan.plan === "expired") {
    const stopped = ws.plan !== "trial" && STOPPED.includes(ws.status ?? "");
    return { reason: "expired", text: stopped ? CAP_MESSAGES.stopped : CAP_MESSAGES.trialOver };
  }
  if (spentUsd >= plan.aiAllowance) return { reason: "allowance", text: plan.trial ? CAP_MESSAGES.trialAllowance : CAP_MESSAGES.allowance };
  return null;
}
