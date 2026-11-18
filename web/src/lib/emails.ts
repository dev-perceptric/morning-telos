// Account emails Morning Telos sends, as pure builders: data in, subject, preview line, HTML and plain text out.
// Copied from Arrowsterr's src/lib/emails.ts (authEmail, securityNoticeEmail). Look and parts: ./emailKit.ts.

import { renderEmail, type Block, type Email, type EmailParts } from "./emailKit.ts";
import { PAID_PLANS, PLANS } from "./plans.ts";

type Footer = EmailParts["footer"];

export type AuthKind = "confirm" | "magic" | "recovery" | "invite" | "email_change_old" | "email_change_new" | "reauth";

export type AuthData = {
  /** The link that finishes the step (Supabase's verify link). */
  url: string;
  /** The address this email goes to. */
  email: string;
  /** The 6-digit code, when Supabase sends one. */
  code?: string;
  /** For an email change: the new address. */
  newEmail?: string;
  /** For an email change: the current address. */
  oldEmail?: string;
  /** The person's name from sign-up, if known. */
  name?: string;
  /** For an invite: who sent it and to which workspace, if known. */
  inviter?: string;
  workspace?: string;
};

const firstName = (name?: string) => name?.trim().split(/\s+/)[0]?.slice(0, 40) || "";
const clip = (s: string | undefined, n = 80) => s?.replace(/\s+/g, " ").trim().slice(0, n) || "";

/**
 * Sign-in emails. The Send Email hook (src/app/api/auth/email-hook) picks one per email_action_type and sends it
 * through Resend.
 */
export function authEmail(kind: AuthKind, a: AuthData): Email {
  const footer: Footer = { text: `Sent by Morning Telos to ${a.email}. This is an account email, so you can't turn it off.` };
  const ignore = (what: string): Block => ({ t: "small", text: `If you didn't ${what}, you can ignore this email. Your account stays as it is.` });
  const code = a.code ? [{ t: "code" as const, label: "Or enter this code", code: a.code }] : [];
  const first = firstName(a.name);
  switch (kind) {
    case "confirm":
      return renderEmail({
        subject: "Confirm your email for Morning Telos",
        preview: a.code ? `Your code is ${a.code}. It works for 1 hour.` : "One click to finish setting up your AI team.",
        title: first ? `Welcome, ${first}` : "Welcome to Morning Telos",
        blocks: [{ t: "p", text: `Confirm ${a.email} to finish setting up your account. Then your AI team can get to work.` }],
        button: { label: "Confirm my email", url: a.url },
        after: [...code, { t: "small", text: "The link and the code work for 1 hour and only once." }, ignore("sign up")],
        footer,
      });
    case "magic":
      return renderEmail({
        subject: a.code ? `${a.code} is your Morning Telos login code` : "Log in to Morning Telos",
        preview: a.code ? `Your code is ${a.code}. It works for 1 hour.` : "One click to log in.",
        title: "Log in to Morning Telos",
        blocks: [{ t: "p", text: `Use the button or the code to log in as ${a.email}. Both work for 1 hour and only once.` }],
        button: { label: "Log in", url: a.url },
        after: [...code, ignore("ask to log in")],
        footer,
      });
    case "recovery":
      return renderEmail({
        subject: "Reset your Morning Telos password",
        preview: `Choose a new password for ${a.email}. The link works for 1 hour.`,
        title: "Reset your password",
        blocks: [{ t: "p", text: `We got a request to reset the password for ${a.email}. The link works for 1 hour and only once.` }],
        button: { label: "Choose a new password", url: a.url },
        after: [...code, { t: "small", text: "If you didn't ask for this, your password stays the same. Someone may have typed your email by mistake." }],
        footer,
      });
    case "invite": {
      const who = clip(a.inviter);
      const where = clip(a.workspace);
      const team = where ? `the ${where} team` : "a team";
      return renderEmail({
        subject: who ? `${who} invited you to Morning Telos` : "You're invited to Morning Telos",
        preview: "Join your team and meet your AI employees.",
        title: "You're invited",
        blocks: [
          { t: "p", text: who ? `${who} invited ${a.email} to join ${team} on Morning Telos.` : `${a.email} was invited to join ${team} on Morning Telos.` },
          { t: "p", text: "Morning Telos gives your business an AI team. You chat with them, tag them with @, and approve their work." },
        ],
        button: { label: "Accept the invite", url: a.url },
        after: [ignore("expect this invite")],
        footer,
      });
    }
    case "email_change_old": {
      const next = a.newEmail ?? "a new address";
      return renderEmail({
        subject: "Confirm your Morning Telos email change",
        preview: `Your email is changing to ${next}.`,
        title: "Confirm your email change",
        blocks: [{ t: "p", text: `Someone asked to change this account's email from ${a.email} to ${next}. Confirm it here to go ahead.` }],
        button: { label: "Confirm the change", url: a.url },
        after: [...code, { t: "small", text: "If you didn't ask for this, don't click the button. Change your password in Settings." }],
        footer,
      });
    }
    case "email_change_new":
      return renderEmail({
        subject: "Confirm your new Morning Telos email",
        preview: "One click to start using this address on Morning Telos.",
        title: "Confirm your new email",
        blocks: [{ t: "p", text: `Confirm ${a.email} as the new email for your Morning Telos account${a.oldEmail ? `. It replaces ${a.oldEmail}` : ""}.` }],
        button: { label: "Confirm new email", url: a.url },
        after: [...code, ignore("ask for this")],
        footer,
      });
    case "reauth":
      return renderEmail({
        subject: `${a.code ?? "Your"} is your Morning Telos security code`,
        preview: "Enter it to finish the change you started.",
        title: "Your security code",
        blocks: [{ t: "p", text: "Enter this code in Morning Telos to finish the change you started, like a new password." }],
        after: [...(a.code ? [{ t: "code" as const, label: "Security code", code: a.code }] : []), ignore("start a change")],
        footer,
      });
  }
}

/** Security notices Supabase can send after a change: a new password, email, sign-in method or 2-step code. */
export function securityNoticeEmail(kind: string, a: { email: string; detail?: string; settingsUrl: string; resetUrl: string }): Email | null {
  const detail = clip(a.detail);
  // Supabase names sign-in providers in lowercase, like "google".
  const method = detail ? detail.charAt(0).toUpperCase() + detail.slice(1) : "";
  const notes: Record<string, [string, string]> = {
    password_changed_notification: ["Your password was changed", "The password for your Morning Telos account was just changed."],
    email_changed_notification: ["Your email was changed", `Your Morning Telos account's email was changed${detail ? ` to ${detail}` : ""}.`],
    identity_linked_notification: ["A login method was added", `${method ? `You can now log in to your Morning Telos account with ${method}` : "A new login method was added to your Morning Telos account"}.`],
    identity_unlinked_notification: ["A login method was removed", `${method ? `You can no longer log in to your Morning Telos account with ${method}` : "A login method was removed from your Morning Telos account"}.`],
    mfa_factor_enrolled_notification: ["2-step login was turned on", "A new 2-step login method was added to your Morning Telos account."],
    mfa_factor_unenrolled_notification: ["2-step login was removed", "A 2-step login method was removed from your Morning Telos account."],
    phone_changed_notification: ["Your phone number was changed", "The phone number on your Morning Telos account was changed."],
  };
  const n = notes[kind];
  if (!n) return null;
  return renderEmail({
    subject: n[0],
    preview: "If this was you, there's nothing to do.",
    title: n[0],
    blocks: [
      { t: "p", text: n[1] },
      { t: "p", text: "If this was you, there's nothing to do. If it wasn't, reset your password now and check your settings." },
    ],
    button: { label: "Reset my password", url: a.resetUrl },
    link: { label: "Open settings", url: a.settingsUrl },
    paste: false,
    footer: { text: `Sent by Morning Telos to ${a.email} to keep your account safe.` },
  });
}

// ─────────────── trial and lifecycle emails ───────────────
// Sent to the workspace's owner by the hourly lifecycle_emails job (src/lib/lifecycleSend.ts). Which one is due
// when: src/lib/lifecycle.ts. Copied from Arrowsterr's trialEmail and tasksEmail.

/** What the team did in a stretch of time, read from chats, approvals and routine runs. */
export type TeamStats = { chats: number; approvals: number; routines: number };

export type OwnerMail = {
  /** The owner's address. */
  email: string;
  /** The workspace's name. */
  workspace: string;
  /** The app's address, like https://chat.morningtelos.com. */
  appUrl: string;
  /** The workspace's time zone, for dates. */
  timezone: string;
};

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const statLines = (s: TeamStats) => [count(s.chats, "chat"), count(s.approvals, "approval done", "approvals done"), count(s.routines, "routine run", "routines run")];
const dayOf = (at: Date, timezone: string) => at.toLocaleDateString("en-US", { timeZone: timezone, weekday: "long", month: "long", day: "numeric" });
const timeOf = (at: Date, timezone: string) => at.toLocaleTimeString("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" });
const shortDay = (at: Date, timezone: string) => at.toLocaleDateString("en-US", { timeZone: timezone, month: "short", day: "numeric" });
const billingUrl = (o: OwnerMail) => `${o.appUrl}/billing`;
const ownerFooter = (o: OwnerMail): Footer => ({ text: `Sent to ${o.email} because you own ${clip(o.workspace)} on Morning Telos. Trial and billing emails always go to the owner.` });

/** Day 7 of the trial: what the team did so far, and how to get more out of it. */
export function trialDay7Email(o: OwnerMail, stats: TeamStats): Email {
  const quiet = !stats.chats && !stats.approvals && !stats.routines;
  return renderEmail({
    subject: "Your first week with your AI team",
    preview: quiet ? "Your team is ready for its first job." : `${statLines(stats).join(", ")} so far.`,
    title: "One week in",
    blocks: [
      { t: "p", text: quiet ? `Your team at ${clip(o.workspace)} is ready, but it has no work yet. Give it a first job today.` : `Here is what your team at ${clip(o.workspace)} did in the first week of your free trial.` },
      ...(quiet ? [] : [{ t: "list" as const, items: statLines(stats) }]),
      { t: "p", text: "Ways to get more out of your team:" },
      {
        t: "list",
        items: [
          "Tag a teammate with @ to give them a job.",
          "Set up a routine so work gets done on a schedule.",
          "Add your services and prices to Knowledge so answers are right.",
          "Connect your email and calendar in Settings, under Apps.",
        ],
      },
    ],
    button: { label: "Open your team", url: o.appUrl },
    footer: ownerFooter(o),
  });
}

const PLAN_LINES = PAID_PLANS.map((p) => `${PLANS[p].name}: $${PLANS[p].price} a month`);

/** 2 days before the trial's last day: pick a plan. */
export function trialDay12Email(o: OwnerMail, ends: Date, plans: string[] = PLAN_LINES): Email {
  return renderEmail({
    subject: "Your free trial ends in 2 days",
    preview: "Pick a plan to keep your team working.",
    title: "2 days left in your trial",
    blocks: [
      { t: "p", text: `Your free trial for ${clip(o.workspace)} ends on ${dayOf(ends, o.timezone)} at ${timeOf(ends, o.timezone)}.` },
      { t: "p", text: "Pick a plan before then to keep your team working. Your chats, knowledge and routines stay as they are." },
      { t: "list", items: plans },
    ],
    button: { label: "Pick a plan", url: billingUrl(o) },
    footer: ownerFooter(o),
  });
}

/** The trial's last day. When the trial ends early in the morning, this goes the day before and says tomorrow. */
export function trialLastDayEmail(o: OwnerMail, ends: Date, now: Date): Email {
  const today = shortDay(ends, o.timezone) === shortDay(now, o.timezone);
  const when = today ? "today" : "tomorrow";
  return renderEmail({
    subject: `Your free trial ends ${when}`,
    preview: "Pick a plan so your team keeps working.",
    title: "Last day of your trial",
    blocks: [
      { t: "p", text: `Your free trial for ${clip(o.workspace)} ends ${when} at ${timeOf(ends, o.timezone)}.` },
      { t: "p", text: "After that, your team stops working until you pick a plan. It only takes a minute." },
    ],
    button: { label: "Pick a plan", url: billingUrl(o) },
    footer: ownerFooter(o),
  });
}

/** The morning after a trial ended with no plan. */
export function trialEndedEmail(o: OwnerMail): Email {
  return renderEmail({
    subject: "Your AI team is paused",
    preview: "Pick a plan to wake them up.",
    title: "Your team is paused",
    blocks: [
      { t: "p", text: `Your free trial for ${clip(o.workspace)} has ended. Your team is paused, so they can't chat or run routines.` },
      { t: "p", text: "Pick a plan to wake them up. Your chats and knowledge are still here." },
    ],
    button: { label: "Pick a plan", url: billingUrl(o) },
    footer: ownerFooter(o),
  });
}

/** 80% of this period's AI allowance is used. */
export function aiAllowanceEmail(o: OwnerMail, u: { percent: number; trial: boolean; top: boolean }): Email {
  const pct = Math.max(0, Math.min(100, Math.round(u.percent)));
  const what = u.trial ? "the AI allowance for your free trial" : "this month's AI allowance";
  const next = u.trial
    ? "When it runs out, your team stops until you pick a plan."
    : u.top
      ? "When it runs out, your team stops until next month."
      : "When it runs out, your team stops until next month. Upgrade your plan for more.";
  return renderEmail({
    subject: `Your team used ${pct}% of its AI allowance`,
    preview: next,
    title: "Your AI allowance is running low",
    blocks: [
      { t: "p", text: `Your team at ${clip(o.workspace)} used ${pct}% of ${what}.` },
      { t: "p", text: next },
    ],
    button: { label: u.trial ? "Pick a plan" : "See your plan", url: billingUrl(o) },
    footer: ownerFooter(o),
  });
}

/** Monday morning: what the team did last week. People can turn it off, so it carries an unsubscribe link. */
export function weeklyDigestEmail(o: OwnerMail, stats: TeamStats, week: { from: Date; to: Date }, unsubscribeUrl: string): Email {
  const quiet = !stats.chats && !stats.approvals && !stats.routines;
  // The week runs to midnight on Monday, so its last day is the Sunday before.
  const last = new Date(week.to.getTime() - 1);
  return renderEmail({
    subject: `Your team's week at ${clip(o.workspace, 60)}`,
    preview: quiet ? "A quiet week. Give your team a job." : `${statLines(stats).join(", ")}.`,
    title: "Your team's week",
    blocks: [
      { t: "p", text: `Here is what your team did from ${shortDay(week.from, o.timezone)} to ${shortDay(last, o.timezone)}.` },
      { t: "list", items: statLines(stats) },
      ...(quiet ? [{ t: "p" as const, text: "It was a quiet week. Tag a teammate with @ or set up a routine to put them to work." }] : []),
    ],
    button: { label: "Open your team", url: o.appUrl },
    footer: {
      text: `Sent to ${o.email} because you own ${clip(o.workspace)} on Morning Telos. You can turn off the weekly digest and tips in Settings.`,
      links: [{ label: "Unsubscribe", url: unsubscribeUrl }],
    },
  });
}
