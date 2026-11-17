// What the invite and delete-workspace routes do. The routes in src/app/api/workspace wire in Supabase and Resend;
// tests pass fakes. Every step checks the caller's role first, then does the work.
import { goodbyeMail, inviteMail, type Mail } from "./workspaceMail.ts";
import { cleanEmail } from "./lockout.ts";
import { deleteConfirmMatches, inviteLink, isRole, NEEDS, type Role } from "./workspace.ts";

export type Caller = { userId: string; email: string | null };
/** Checks the caller has at least this role in the workspace (requireRole in src/lib/serverAuth.ts). */
export type Gate = (min: Role) => Promise<({ ok: true } & Caller) | { ok: false; status: number; error: string }>;
export type Result = { status: number; body: Record<string, unknown> };
/** Sends one email. False when email isn't set up. */
export type SendMail = (to: string, mail: Mail) => Promise<boolean>;

const fail = (error: string, status = 400): Result => ({ status, body: { error } });

export type Invite = { id: string; email: string; role: Role; token: string; expires_at: string };

export type InviteDeps = {
  gate: Gate;
  /** Where the app is served, for the link. */
  origin: string;
  workspaceName: () => Promise<string | null>;
  memberEmails: () => Promise<string[]>;
  /** Cancels any open invite for this email, then makes a new one. Runs as the caller, so row level security applies. */
  saveInvite: (row: { email: string; role: Role; invited_by: string }) => Promise<Invite>;
  send: SendMail;
};

export async function createInvite(input: { email?: unknown; role?: unknown }, d: InviteDeps): Promise<Result> {
  const who = await d.gate(NEEDS.invite);
  if (!who.ok) return fail(who.error, who.status);
  const email = cleanEmail(input.email);
  if (!email) return fail("Enter a real email address.");
  const role = input.role;
  if (!isRole(role) || role === "owner") return fail("Pick admin, editor or viewer.");
  if (who.email && email === who.email.toLowerCase()) return fail("You are already in this workspace.");
  if ((await d.memberEmails()).some((m) => m.toLowerCase() === email)) return fail("That person is already in this workspace.");

  const invite = await d.saveInvite({ email, role, invited_by: who.userId });
  const link = inviteLink(d.origin, invite.token);
  const workspace = (await d.workspaceName()) ?? "a workspace";
  let emailed = false;
  let emailError = "";
  try {
    emailed = await d.send(email, inviteMail({ workspace, inviter: who.email, role, link }));
  } catch {
    emailError = "We couldn't send the email. Copy the link and send it yourself.";
  }
  return { status: 200, body: { invite, link, emailed, ...(emailError ? { emailError } : {}) } };
}

export type DeleteDeps = {
  gate: Gate;
  workspaceName: () => Promise<string | null>;
  /** Deletes the workspace. Its members, invites and every other row with its workspace_id go with it. */
  remove: () => Promise<void>;
  send: SendMail;
};

export async function deleteWorkspace(input: { confirm?: unknown }, d: DeleteDeps): Promise<Result> {
  const who = await d.gate(NEEDS.deleteWorkspace);
  if (!who.ok) return fail(who.error, who.status);
  const name = await d.workspaceName();
  if (name === null) return fail("We couldn't find that workspace.", 404);
  if (!deleteConfirmMatches(input.confirm, name)) return fail(`Type ${name} to confirm.`);
  await d.remove();
  let emailed = false;
  if (who.email) {
    try {
      emailed = await d.send(who.email, goodbyeMail({ workspace: name }));
    } catch {
      // The workspace is gone either way. A missed goodbye email shouldn't look like a failed delete.
    }
  }
  return { status: 200, body: { ok: true, emailed } };
}
