// The staff console: every customer workspace for the Morning Telos team, and the few fixes staff make by hand (plan,
// trial, a failed job). Plan Phase 5, "staff console".
//
// Who is staff: the server's STAFF_EMAILS (a comma list), matched without case to the signed-in person's confirmed
// email. Everyone else gets 404 from every staff route, so the console looks like it isn't there.
//
// Pure: the route (src/app/api/staff/[action]/route.ts) wires in Supabase with the service role, and tests pass fakes.
// Every change goes through one SQL function that also writes its staff_actions row (supabase/017_staff.sql).
// Shared with the screens (no server-only imports).

import { effectivePlan, PLANS, type EffectivePlan, type PlanId } from "./plans.ts";

// ─────────────── who is staff ───────────────

/** The staff emails in STAFF_EMAILS, lowercase. Empty or unset means nobody. */
export function staffEmails(raw: string | null | undefined): Set<string> {
  return new Set(
    String(raw ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)),
  );
}

export type SignedIn = { id: string; email?: string | null; email_confirmed_at?: string | null };

/** True when this person is signed in with a confirmed email that is in STAFF_EMAILS. */
export function isStaff(user: SignedIn | null | undefined, raw: string | null | undefined): boolean {
  if (!user?.id || !user.email || !user.email_confirmed_at) return false;
  return staffEmails(raw).has(user.email.trim().toLowerCase());
}

// ─────────────── times ───────────────

const DAY = 864e5;
/** Trials that end within this many days show in the top strip. */
export const TRIAL_SOON_DAYS = 3;
/** An approval waiting longer than this shows on the workspace. */
export const STALE_APPROVAL_MS = DAY;
export const MAX_TRIAL_DAYS = 90;

/** The start of this calendar month in UTC, where "AI spend this month" starts counting. */
export function monthStart(now = Date.now()): string {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

/** The trial's new end: `days` after its current end, or after now when it already ended. Same rule as staff_extend_trial(). */
export function extendedTrialEnd(current: string | null | undefined, days: number, now = Date.now()): string {
  const t = current ? Date.parse(current) : NaN;
  return new Date(Math.max(Number.isFinite(t) ? t : now, now) + days * DAY).toISOString();
}

// ─────────────── workspaces ───────────────

/** One row of staff_workspaces(). */
export type StaffWorkspaceRow = {
  id: string;
  name: string;
  website: string | null;
  plan: string;
  status: string | null;
  trial_ends_at: string | null;
  period_start: string | null;
  stripe_subscription_id: string | null;
  created_at: string;
  owner_email: string | null;
  members: number;
  ai_usd: number | string | null;
};

export type StaffWorkspace = {
  id: string;
  name: string;
  website: string | null;
  ownerEmail: string | null;
  /** The plan saved on the workspace. */
  plan: string;
  /** The plan in force (effectivePlan). */
  effective: EffectivePlan;
  status: string | null;
  trialEndsAt: string | null;
  daysLeft: number;
  members: number;
  /** US dollars of AI this calendar month. */
  aiMonth: number;
  /** The plan's AI allowance a month. Null on the internal plan, which has no real limit. */
  allowance: number | null;
  /** True when Stripe bills this workspace, so Stripe may change a plan staff set. */
  stripe: boolean;
  createdAt: string;
};

const money = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};

export function toStaffWorkspace(r: StaffWorkspaceRow, now = Date.now()): StaffWorkspace {
  const p = effectivePlan(r, now);
  return {
    id: r.id,
    name: r.name,
    website: r.website ?? null,
    ownerEmail: r.owner_email ?? null,
    plan: r.plan,
    effective: p.plan,
    status: r.status ?? null,
    trialEndsAt: r.trial_ends_at ?? null,
    daysLeft: p.daysLeft,
    members: Number(r.members) || 0,
    aiMonth: money(r.ai_usd),
    allowance: p.plan === "internal" ? null : p.aiAllowance,
    stripe: Boolean(r.stripe_subscription_id),
    createdAt: r.created_at,
  };
}

/** Workspaces whose name, owner email or website has the words typed, any case. Empty finds all. */
export function searchWorkspaces<T extends { name: string; ownerEmail: string | null; website?: string | null }>(rows: readonly T[], q: unknown): T[] {
  const words = String(q ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8);
  if (!words.length) return [...rows];
  return rows.filter((r) => {
    const hay = `${r.name} ${r.ownerEmail ?? ""} ${r.website ?? ""}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** True for a trial in force that ends within TRIAL_SOON_DAYS. */
export function trialEndingSoon(w: Pick<StaffWorkspace, "effective" | "trialEndsAt">, now = Date.now()): boolean {
  if (w.effective !== "trial" || !w.trialEndsAt) return false;
  const t = Date.parse(w.trialEndsAt);
  return Number.isFinite(t) && t > now && t - now <= TRIAL_SOON_DAYS * DAY;
}

export const PLAN_ORDER: readonly EffectivePlan[] = ["trial", "starter", "pro", "internal", "expired"];

export type StaffSummary = {
  workspaces: number;
  byPlan: Record<EffectivePlan, number>;
  trialsEnding: number;
  failedJobs: number;
  aiMonth: number;
};

/** The top strip: workspaces by plan in force, trials ending soon, failed jobs in the last day, and AI spend this month. */
export function summarize(rows: readonly StaffWorkspace[], o: { failedJobs: number; aiTotal: unknown }, now = Date.now()): StaffSummary {
  const byPlan = Object.fromEntries(PLAN_ORDER.map((p) => [p, 0])) as Record<EffectivePlan, number>;
  for (const r of rows) byPlan[r.effective] += 1;
  return { workspaces: rows.length, byPlan, trialsEnding: rows.filter((r) => trialEndingSoon(r, now)).length, failedJobs: o.failedJobs, aiMonth: money(o.aiTotal) };
}

// ─────────────── jobs, services and approvals ───────────────

export type StaffJob = { id: number; kind: string; attempts: number; max_attempts: number; last_error: string | null; run_at: string; created_at: string; done_at: string | null };

/** A job that gave up: not done, and every attempt used (src/lib/jobs.ts). */
export const isFailedJob = (j: Pick<StaffJob, "attempts" | "max_attempts" | "done_at">) => !j.done_at && j.attempts >= j.max_attempts;

export type StaffService = { product: string; status: string; brand_id: string | null; key_prefix: string | null; last_error: string | null; updated_at: string };
export type StaffApproval = { id: number; agent: string; title: string; created_at: string };
export type StaffAction = { id: number; staff_email: string | null; action: string; details: Record<string, unknown>; created_at: string };

// ─────────────── changes ───────────────

/** Plans staff can set. */
export const STAFF_PLANS: readonly PlanId[] = ["trial", "starter", "pro", "internal"];
export const isStaffPlan = (p: unknown): p is PlanId => typeof p === "string" && (STAFF_PLANS as string[]).includes(p);

/**
 * The plan and status staff save. The status makes the plan count (effectivePlan): a trial is trialing, and a paid or
 * internal plan set by hand is active.
 */
export function planPatch(plan: PlanId): { plan: PlanId; status: string } {
  return { plan, status: plan === "trial" ? "trialing" : "active" };
}

export const STAFF_MESSAGES = {
  notFound: "Not found.",
  noWorkspace: "That workspace was not found.",
  pickPlan: "Pick trial, starter, pro or internal.",
  samePlan: "The workspace is already on that plan.",
  days: `Enter a whole number of days from 1 to ${MAX_TRIAL_DAYS}.`,
  noJob: "That job is not a failed job in this workspace. It may have run again already.",
  failed: "Something went wrong. Try again.",
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/** A whole number of days, 1 to MAX_TRIAL_DAYS, or null. */
export function readDays(v: unknown): number | null {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= MAX_TRIAL_DAYS ? n : null;
}

/** A job id, or null. */
export function readJobId(v: unknown): number | null {
  const n = typeof v === "string" && /^\d{1,15}$/.test(v) ? Number(v) : v;
  return typeof n === "number" && Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** What one staff action did, in a few words, for the workspace's log. */
export function actionLine(a: Pick<StaffAction, "action" | "details">): string {
  const d = a.details ?? {};
  const to = (d.to ?? {}) as Record<string, unknown>;
  const from = (d.from ?? {}) as Record<string, unknown>;
  const planName = (p: unknown) => (isStaffPlan(p) ? PLANS[p].name : String(p ?? "none"));
  if (a.action === "set_plan") return `Plan changed from ${planName(from.plan)} to ${planName(to.plan)}`;
  if (a.action === "extend_trial") return `Trial extended by ${Number(d.days) || 0} day${Number(d.days) === 1 ? "" : "s"}`;
  if (a.action === "retry_job") return `Job ${String(d.kind ?? "")} sent to run again`.replace(/\s+/g, " ");
  return a.action;
}

// ─────────────── the routes ───────────────

export type StaffCaller = { userId: string; email: string };
export type Result = { status: number; body: Record<string, unknown> };

export type StaffDeps = {
  /** The signed-in person when they are staff (isStaff), or null. */
  staff: () => Promise<StaffCaller | null>;
  now: () => number;
  /** staff_workspaces(): every workspace, or just one. */
  workspaces: (since: string, id?: string) => Promise<StaffWorkspaceRow[]>;
  /** staff_ai_total(): all AI spend since a time. */
  aiTotal: (since: string) => Promise<number | string>;
  /** Jobs not done whose last run was due since a time, any workspace. */
  openJobsSince: (since: string) => Promise<Pick<StaffJob, "attempts" | "max_attempts" | "done_at">[]>;
  /** One workspace's jobs that are not done. */
  openJobs: (ws: string) => Promise<StaffJob[]>;
  services: (ws: string) => Promise<StaffService[]>;
  /** One workspace's approvals still pending that were made before a time. */
  pendingBefore: (ws: string, before: string) => Promise<StaffApproval[]>;
  actions: (ws: string) => Promise<StaffAction[]>;
  /** staff_set_plan(), staff_extend_trial(), staff_retry_job(): the change plus its staff_actions row. Null when nothing matched. */
  setPlan: (who: StaffCaller, ws: string, patch: { plan: PlanId; status: string }) => Promise<Record<string, unknown> | null>;
  extendTrial: (who: StaffCaller, ws: string, days: number) => Promise<Record<string, unknown> | null>;
  retryJob: (who: StaffCaller, ws: string, jobId: number) => Promise<Record<string, unknown> | null>;
};

export const STAFF_ACTIONS = ["me", "overview", "workspace", "plan", "trial", "retry"] as const;
export type StaffRouteAction = (typeof STAFF_ACTIONS)[number];

const fail = (error: string, status = 400): Result => ({ status, body: { error } });
const NOT_FOUND = (): Result => fail(STAFF_MESSAGES.notFound, 404);

/**
 * POST /api/staff/<action>. Anyone who isn't staff, and any unknown action, gets the same 404.
 *   me         { staff: true }
 *   overview   { q? }: the top strip and every workspace matching the search
 *   workspace  { workspaceId }: one workspace, its services, failed jobs, approvals waiting over a day and the staff log
 *   plan       { workspaceId, plan }
 *   trial      { workspaceId, days }
 *   retry      { workspaceId, jobId }
 */
export async function staffRoute(action: string, body: Record<string, unknown>, d: StaffDeps): Promise<Result> {
  const who = await d.staff();
  if (!who || !(STAFF_ACTIONS as readonly string[]).includes(action)) return NOT_FOUND();
  const now = d.now();
  const since = monthStart(now);

  if (action === "me") return { status: 200, body: { staff: true } };

  if (action === "overview") {
    const dayAgo = new Date(now - DAY).toISOString();
    const [rows, total, jobs] = await Promise.all([d.workspaces(since), d.aiTotal(since), d.openJobsSince(dayAgo)]);
    const all = rows.map((r) => toStaffWorkspace(r, now));
    const summary = summarize(all, { failedJobs: jobs.filter(isFailedJob).length, aiTotal: total }, now);
    return { status: 200, body: { summary, workspaces: searchWorkspaces(all, body.q), since } };
  }

  const ws = body.workspaceId;
  if (!isUuid(ws)) return fail(STAFF_MESSAGES.noWorkspace, 404);
  const [row] = await d.workspaces(since, ws);
  if (!row || row.id !== ws) return fail(STAFF_MESSAGES.noWorkspace, 404);
  const current = toStaffWorkspace(row, now);

  if (action === "workspace") {
    const [services, jobs, approvals, actions] = await Promise.all([d.services(ws), d.openJobs(ws), d.pendingBefore(ws, new Date(now - STALE_APPROVAL_MS).toISOString()), d.actions(ws)]);
    return { status: 200, body: { workspace: current, services, failedJobs: jobs.filter(isFailedJob), staleApprovals: approvals, actions: actions.map((a) => ({ ...a, line: actionLine(a) })) } };
  }

  if (action === "plan") {
    if (!isStaffPlan(body.plan)) return fail(STAFF_MESSAGES.pickPlan);
    const patch = planPatch(body.plan);
    if (row.plan === patch.plan && row.status === patch.status) return fail(STAFF_MESSAGES.samePlan);
    const done = await d.setPlan(who, ws, patch);
    if (!done) return fail(STAFF_MESSAGES.noWorkspace, 404);
    return { status: 200, body: { ok: true, details: done } };
  }

  if (action === "trial") {
    const days = readDays(body.days);
    if (!days) return fail(STAFF_MESSAGES.days);
    const done = await d.extendTrial(who, ws, days);
    if (!done) return fail(STAFF_MESSAGES.noWorkspace, 404);
    return { status: 200, body: { ok: true, details: done } };
  }

  // retry
  const jobId = readJobId(body.jobId);
  if (!jobId) return fail(STAFF_MESSAGES.noJob, 404);
  const done = await d.retryJob(who, ws, jobId);
  if (!done) return fail(STAFF_MESSAGES.noJob, 404);
  return { status: 200, body: { ok: true, details: done } };
}
