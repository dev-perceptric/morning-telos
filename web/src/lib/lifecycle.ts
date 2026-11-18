// Which trial and lifecycle emails a workspace is due right now. Pure: the hourly lifecycle_emails job
// (src/lib/lifecycleSend.ts) reads the workspaces and asks this file, then sends each email once (email_log in
// supabase/018_email_log.sql). Copied from Arrowsterr's nudges.ts (trial ending, tasks at 80%), with the times
// in the workspace's own time zone so emails land in the morning.
//
// The emails, in order:
//   trial_day7      day 7 of the free trial: what the team did so far, and how to get more out of it.
//   trial_day12     2 days before the trial ends: pick a plan.
//   trial_last_day  the trial's last day.
//   trial_ended     the morning after a trial ended with no plan: the team is paused.
//   ai_80           80% of this period's AI allowance is used.
//   weekly_digest   Monday morning: what the team did last week. People can turn this one off.

import { spendWindowStart, type MeterWorkspace } from "./meter.ts";
import { effectivePlan, TRIAL_DAYS } from "./plans.ts";

export const LIFECYCLE_KINDS = ["trial_day7", "trial_day12", "trial_last_day", "trial_ended", "ai_80", "weekly_digest"] as const;
export type LifecycleKind = (typeof LIFECYCLE_KINDS)[number];

/** Emails a person can turn off in Settings or with the unsubscribe link. Trial and billing emails always go. */
export const OPTIONAL_KINDS: ReadonlySet<LifecycleKind> = new Set<LifecycleKind>(["weekly_digest"]);

/** Morning emails go out from this hour, in the workspace's time zone. */
export const SEND_HOUR = 9;
/** Share of the AI allowance that sends the ai_80 email. */
export const AI_WARN_AT = 0.8;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** The trial_ended email still goes this long after its morning, if the worker missed it. */
const ENDED_GRACE_MS = 3 * DAY_MS;
/** A workspace younger than this gets no weekly digest yet. */
const DIGEST_MIN_AGE_MS = 3 * DAY_MS;
/** Same fallback as due_routines() in 014_routines_skills_memory.sql. */
export const DEFAULT_TZ = "America/Chicago";

export type LifecycleWorkspace = MeterWorkspace & { id: string; timezone?: string | null; created_at?: string | null };
export type DueEmail = { kind: LifecycleKind; periodKey: string };

// ─────────────── time zones ───────────────

const formats = new Map<string, Intl.DateTimeFormat>();
function format(tz: string) {
  let f = formats.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    formats.set(tz, f);
  }
  return f;
}

/** The time zone if the browser's list knows it, else the default. One bad row never stops the rest. */
export function zoneOf(tz: string | null | undefined): string {
  if (!tz) return DEFAULT_TZ;
  try {
    format(tz);
    return tz;
  } catch {
    return DEFAULT_TZ;
  }
}

function parts(at: number, tz: string) {
  const p = Object.fromEntries(format(tz).formatToParts(new Date(at)).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour) % 24, min: Number(p.minute), s: Number(p.second) };
}

/** The date (YYYY-MM-DD) it is at `at` in this time zone. */
export function localDate(at: number, tz: string): string {
  const p = parts(at, tz);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/** A date plus some days. */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** 0 for Sunday to 6 for Saturday. */
export const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

const offsetAt = (at: number, tz: string) => {
  const p = parts(at, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(at / 1000) * 1000;
};

/** The moment it is `hour`:00 on `date` in this time zone. */
export function zonedTime(date: string, hour: number, tz: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, hour);
  const first = guess - offsetAt(guess, tz);
  const second = guess - offsetAt(first, tz);
  return second;
}

// ─────────────── the trial's emails ───────────────

export type TrialTimes = { day7: number; day12: number; lastDay: number; ended: number };

/**
 * When each trial email goes out, at SEND_HOUR local time: day 7 of the trial, 2 days before the last day, the
 * last day, and the morning after. A trial that ends before SEND_HOUR + 1 gets its last-day email the morning before,
 * so it never comes after the trial is over.
 */
export function trialTimes(trialEndsAt: number, tz: string): TrialTimes {
  const end = localDate(trialEndsAt, tz);
  const start = localDate(trialEndsAt - TRIAL_DAYS * DAY_MS, tz);
  const at = (date: string) => zonedTime(date, SEND_HOUR, tz);
  let lastDay = at(end);
  if (lastDay > trialEndsAt - HOUR_MS) lastDay = at(addDays(end, -1));
  return { day7: at(addDays(start, 6)), day12: at(addDays(end, -2)), lastDay, ended: at(addDays(end, 1)) };
}

/** True when the plan in force needs an AI spend number for the ai_80 email. */
export function needsSpend(ws: LifecycleWorkspace, now: number): boolean {
  const p = effectivePlan(ws, now).plan;
  return p === "trial" || p === "starter" || p === "pro";
}

/**
 * Which allowance period the AI spend counts for. The trial's whole allowance is one period. A paid plan's is the
 * billing period from period_start, or the calendar month when period_start is missing or stale (a missed webhook),
 * so the email never goes out again every day.
 */
export function allowancePeriod(ws: LifecycleWorkspace, now: number): string {
  const plan = effectivePlan(ws, now);
  const since = spendWindowStart(ws, now);
  if (plan.plan === "trial") return `trial:${since.slice(0, 10)}`;
  const start = ws.period_start ? Date.parse(ws.period_start) : NaN;
  if (Number.isFinite(start) && new Date(start).toISOString() === since) return `${plan.plan}:${since.slice(0, 10)}`;
  return `${plan.plan}:${new Date(now).toISOString().slice(0, 7)}`;
}

/** The week a Monday digest covers: last Monday at midnight to this Monday at midnight, local time. */
export function digestWeek(now: number, tz: string): { from: string; to: string } {
  const today = localDate(now, tz);
  const monday = addDays(today, -((weekday(today) + 6) % 7));
  return { from: new Date(zonedTime(addDays(monday, -7), 0, tz)).toISOString(), to: new Date(zonedTime(monday, 0, tz)).toISOString() };
}

/**
 * The emails this workspace is due right now, each with the key that makes it once only. Run it every hour: each
 * email has a window, and a run outside it (too early, or the next email's turn already) returns nothing for it.
 * `spentUsd` is this period's AI spend, or null when it wasn't read (see needsSpend).
 */
export function dueEmails(ws: LifecycleWorkspace, o: { now: number; spentUsd: number | null }): DueEmail[] {
  const { now } = o;
  const tz = zoneOf(ws.timezone);
  const plan = effectivePlan(ws, now);
  const out: DueEmail[] = [];
  const created = ws.created_at ? Date.parse(ws.created_at) : NaN;

  const ends = ws.trial_ends_at ? Date.parse(ws.trial_ends_at) : NaN;
  if (Number.isFinite(ends)) {
    const t = trialTimes(ends, tz);
    const key = new Date(ends).toISOString().slice(0, 10);
    if (plan.plan === "trial") {
      // A workspace made after day 7 (a second workspace starts with what's left of the person's trial) skips it.
      if (t.day7 <= now && now < t.day12 && !(created > t.day7)) out.push({ kind: "trial_day7", periodKey: key });
      if (t.day12 <= now && now < t.lastDay) out.push({ kind: "trial_day12", periodKey: key });
      if (t.lastDay <= now && now < ends) out.push({ kind: "trial_last_day", periodKey: key });
    }
    // Only a trial that ended with no plan. A first payment still going through ('incomplete') is left to Stripe.
    if (plan.plan === "expired" && ws.plan === "trial" && ws.status !== "incomplete" && t.ended <= now && now < t.ended + ENDED_GRACE_MS) {
      out.push({ kind: "trial_ended", periodKey: key });
    }
  }

  if (o.spentUsd !== null && needsSpend(ws, now) && plan.aiAllowance > 0 && o.spentUsd >= plan.aiAllowance * AI_WARN_AT) {
    out.push({ kind: "ai_80", periodKey: allowancePeriod(ws, now) });
  }

  if (plan.plan !== "expired") {
    const today = localDate(now, tz);
    const young = Number.isFinite(created) && now - created < DIGEST_MIN_AGE_MS;
    if (weekday(today) === 1 && zonedTime(today, SEND_HOUR, tz) <= now && !young) out.push({ kind: "weekly_digest", periodKey: today });
  }
  return out;
}
