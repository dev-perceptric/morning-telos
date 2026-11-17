// The invite and goodbye emails, and sending through Resend. Plain on purpose: the auth emails work (P1.4)
// gives every email the Morning Telos look later. Sending is copied from Arrowsterr's src/lib/email.ts.
import { roleLabel, type Role } from "./workspace.ts";

export type Mail = { subject: string; html: string; text: string };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function page(lines: string[], button?: { label: string; href: string }): string {
  const body = lines.map((l) => `<p style="margin:0 0 16px">${esc(l)}</p>`).join("");
  const cta = button
    ? `<p style="margin:24px 0"><a href="${esc(button.href)}" style="background:#141413;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600">${esc(button.label)}</a></p>`
    : "";
  return `<div style="font-family:system-ui,-apple-system,sans-serif;font-size:16px;line-height:1.5;color:#141413;max-width:520px">${body}${cta}<p style="margin:24px 0 0;color:#8c8b84;font-size:13px">Morning Telos</p></div>`;
}

export function inviteMail(p: { workspace: string; inviter: string | null; role: Role; link: string }): Mail {
  const who = p.inviter ? `${p.inviter} invited you` : "You were invited";
  const lines = [
    `${who} to join ${p.workspace} on Morning Telos as ${/^[AEIOU]/.test(roleLabel(p.role)) ? "an" : "a"} ${roleLabel(p.role).toLowerCase()}.`,
    "Morning Telos gives a small business an AI team that does real work. Open the link to join. Use this email address to sign up or log in.",
    "The link works for 7 days.",
  ];
  return {
    subject: `Join ${p.workspace} on Morning Telos`,
    html: page(lines, { label: "Join the team", href: p.link }),
    text: `${lines.join("\n\n")}\n\n${p.link}\n`,
  };
}

export function goodbyeMail(p: { workspace: string }): Mail {
  const lines = [
    `Your workspace ${p.workspace} is deleted. We removed its members, invites and everything your team made.`,
    "Thank you for trying Morning Telos. If you want to come back, you can start again any time.",
    "If you did not ask for this, reply to this email right away.",
  ];
  return { subject: `${p.workspace} was deleted`, html: page(lines), text: `${lines.join("\n\n")}\n` };
}

export type ResendSettings = { key: string; from: string; fetch: typeof fetch };

/** Send one email through Resend. Returns false when Resend isn't set up, and throws when Resend says no. */
export async function sendMail(r: ResendSettings, to: string, mail: Mail): Promise<boolean> {
  if (!r.key || !to) return false;
  const res = await r.fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${r.key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: r.from, to: [to], subject: mail.subject, html: mail.html, text: mail.text }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Resend returned ${res.status}`);
  return true;
}

export const DEFAULT_FROM = "Morning Telos <hello@morningtelos.com>";
