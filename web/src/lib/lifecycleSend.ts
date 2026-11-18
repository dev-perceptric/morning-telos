// The hourly lifecycle_emails job: for each workspace, ask lifecycle.ts which emails are due, then send each one to
// the owner once. Copied from Arrowsterr's sendNudges and once(). The database sits behind LifecycleStore
// (src/lib/lifecycleDb.ts wires it to Supabase), so tests pass a fake store and a fake fetch.
//
// Once only: the email_log row goes in first (the claim). A second run finds the row and skips. If Resend says no,
// the row is taken out again so the next run tries again, with the same idempotency key so Resend never sends twice.

import { sendBuilt, type ResendDeps } from "./email.ts";
import type { Email } from "./emailKit.ts";
import { aiAllowanceEmail, trialDay12Email, trialDay7Email, trialEndedEmail, trialLastDayEmail, weeklyDigestEmail, type OwnerMail, type TeamStats } from "./emails.ts";
import { digestWeek, dueEmails, needsSpend, OPTIONAL_KINDS, zoneOf, type DueEmail, type LifecycleWorkspace } from "./lifecycle.ts";
import { spendWindowStart } from "./meter.ts";
import { effectivePlan, TRIAL_DAYS } from "./plans.ts";
import { unsubscribeHeaders } from "./unsubscribe.ts";

export type Owner = { userId: string; email: string };
export type LogRow = { workspace_id: string; user_id: string; kind: string; period_key: string };
export type StoredWorkspace = LifecycleWorkspace & { name: string };

export type LifecycleStore = {
  /** Every workspace, with its plan, trial, period, time zone and when it was made. */
  workspaces: () => Promise<StoredWorkspace[]>;
  /** AI spend in US dollars since this moment. */
  spend: (workspaceId: string, since: string) => Promise<number>;
  /** Who owns the workspace (one person), with an email address. */
  owners: (workspaceId: string) => Promise<Owner[]>;
  /** False when the person turned off the weekly digest and tips for this workspace. */
  digestOn: (workspaceId: string, userId: string) => Promise<boolean>;
  /** What the team did from `from` up to `to`. */
  stats: (workspaceId: string, from: string, to: string) => Promise<TeamStats>;
  /** Insert the email_log row. False when it was already there. */
  claim: (row: LogRow) => Promise<boolean>;
  /** Take the row out again after a send that failed. */
  unclaim: (row: LogRow) => Promise<void>;
};

export type LifecycleDeps = {
  store: LifecycleStore;
  resend: ResendDeps;
  appUrl: string;
  now: () => number;
  /** The unsubscribe link for this person, or null when links can't be made (no SEALING_KEYS). */
  unsubscribeUrl: (workspaceId: string, userId: string) => string | null;
  log: (message: string) => void;
};

export type LifecycleRun = { sent: number; skipped: number; failed: number; off?: string };

/** The email itself, from what's due and the facts it needs. Null when it can't be made (no unsubscribe link). */
async function build(ws: StoredWorkspace, due: DueEmail, owner: Owner, d: LifecycleDeps, now: number, spentUsd: number | null): Promise<{ mail: Email; headers?: Record<string, string> } | null> {
  const o: OwnerMail = { email: owner.email, workspace: ws.name, appUrl: d.appUrl, timezone: zoneOf(ws.timezone) };
  const ends = new Date(ws.trial_ends_at ?? now);
  switch (due.kind) {
    case "trial_day7": {
      const from = new Date(ends.getTime() - TRIAL_DAYS * 864e5).toISOString();
      return { mail: trialDay7Email(o, await d.store.stats(ws.id, from, new Date(now).toISOString())) };
    }
    case "trial_day12":
      return { mail: trialDay12Email(o, ends) };
    case "trial_last_day":
      return { mail: trialLastDayEmail(o, ends, new Date(now)) };
    case "trial_ended":
      return { mail: trialEndedEmail(o) };
    case "ai_80": {
      const plan = effectivePlan(ws, now);
      const spent = spentUsd ?? 0;
      return { mail: aiAllowanceEmail(o, { percent: plan.aiAllowance ? (spent / plan.aiAllowance) * 100 : 100, trial: plan.trial, top: plan.plan === "pro" }) };
    }
    case "weekly_digest": {
      const url = d.unsubscribeUrl(ws.id, owner.userId);
      if (!url) return null;
      const week = digestWeek(now, o.timezone);
      const stats = await d.store.stats(ws.id, week.from, week.to);
      return { mail: weeklyDigestEmail(o, stats, { from: new Date(week.from), to: new Date(week.to) }, url), headers: unsubscribeHeaders(url) };
    }
  }
}

/** One run. Each workspace and each email has its own try, so one bad row never stops the rest. */
export async function sendLifecycleEmails(d: LifecycleDeps): Promise<LifecycleRun> {
  const run: LifecycleRun = { sent: 0, skipped: 0, failed: 0 };
  if (!d.resend.key) return { ...run, off: "RESEND_API_KEY is not set." };
  const list = await d.store.workspaces();
  for (const ws of list) {
    const now = d.now();
    let due: DueEmail[];
    let spentUsd: number | null = null;
    try {
      spentUsd = needsSpend(ws, now) ? await d.store.spend(ws.id, spendWindowStart(ws, now)) : null;
      due = dueEmails(ws, { now, spentUsd });
      if (!due.length) continue;
    } catch (e) {
      run.failed++;
      d.log(`Lifecycle emails for workspace ${ws.id}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    let owners: Owner[];
    try {
      owners = (await d.store.owners(ws.id)).filter((x) => x.email);
    } catch (e) {
      run.failed++;
      d.log(`Lifecycle emails for workspace ${ws.id}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    for (const item of due) {
      for (const owner of owners) {
        const row: LogRow = { workspace_id: ws.id, user_id: owner.userId, kind: item.kind, period_key: item.periodKey };
        let claimed = false;
        try {
          if (OPTIONAL_KINDS.has(item.kind) && !(await d.store.digestOn(ws.id, owner.userId))) {
            run.skipped++;
            continue;
          }
          const made = await build(ws, item, owner, d, now, spentUsd);
          if (!made) {
            run.skipped++;
            continue;
          }
          claimed = await d.store.claim(row);
          if (!claimed) {
            run.skipped++;
            continue;
          }
          const ok = await sendBuilt([owner.email], made.mail, d.resend, { idempotencyKey: `lifecycle/${item.kind}/${ws.id}/${owner.userId}/${item.periodKey}`, headers: made.headers });
          if (!ok) throw new Error("Resend is not set up.");
          run.sent++;
        } catch (e) {
          run.failed++;
          d.log(`Email ${item.kind} for workspace ${ws.id} failed: ${e instanceof Error ? e.message : String(e)}`);
          if (claimed) await d.store.unclaim(row).catch((err) => d.log(`Could not take back the ${item.kind} claim for workspace ${ws.id}: ${err instanceof Error ? err.message : String(err)}`));
        }
      }
    }
  }
  return run;
}
