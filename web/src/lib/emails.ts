// Account emails Morning Telos sends, as pure builders: data in, subject, preview line, HTML and plain text out.
// Copied from Arrowsterr's src/lib/emails.ts (authEmail, securityNoticeEmail). Look and parts: ./emailKit.ts.

import { renderEmail, type Block, type Email, type EmailParts } from "./emailKit.ts";

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
