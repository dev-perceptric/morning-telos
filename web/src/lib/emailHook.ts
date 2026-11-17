// Supabase's Send Email hook, copied from Arrowsterr's src/app/api/auth/email-hook. Supabase calls the route for
// every account email, and Morning Telos designs it and sends it through Resend. This file holds the logic: check
// the signature, pick the email for each email_action_type, send. The route wires in the server's settings.
import { sendBuilt, type ResendDeps } from "./email.ts";
import type { Email } from "./emailKit.ts";
import { authEmail, securityNoticeEmail, type AuthData, type AuthKind } from "./emails.ts";
import { verifyWebhook } from "./standardWebhooks.ts";

export { HOOK_WINDOW, verifyWebhook } from "./standardWebhooks.ts";

export type HookPayload = {
  user: { id?: string; email: string; new_email?: string; user_metadata?: Record<string, unknown> };
  email_data: {
    token?: string;
    token_hash?: string;
    redirect_to?: string;
    email_action_type: string;
    site_url?: string;
    token_new?: string;
    token_hash_new?: string;
    old_email?: string;
    email?: string;
    provider?: string;
    factor_type?: string;
  };
};

export type HookUrls = { supabaseUrl: string; appUrl: string };

/** The link Supabase checks before signing the person in or finishing the change. */
export function verifyUrl(u: HookUrls, hash: string, type: string, redirect?: string) {
  const q = new URLSearchParams({ token: hash, type, redirect_to: redirect || u.appUrl });
  return `${u.supabaseUrl}/auth/v1/verify?${q}`;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Who sent the invite, when the inviter's name (not their id) is in the user's metadata. */
function inviterName(meta: Record<string, unknown>) {
  const name = str(meta.invited_by_name) ?? str(meta.invited_by);
  return name && !UUID.test(name) ? name : undefined;
}

export type Outgoing = { to: string; mail: Email };

/** The emails one hook call sends: usually one, two for a secure email change, none for a kind we don't know. */
export function emailsFor(p: HookPayload, u: HookUrls): Outgoing[] {
  const d = p.email_data;
  const to = p.user.email;
  const meta = p.user.user_metadata ?? {};
  const base: Omit<AuthData, "url" | "email"> = {
    name: str(meta.name) ?? str(meta.full_name),
    inviter: inviterName(meta),
    workspace: str(meta.workspace_name),
  };
  const make = (kind: AuthKind, address: string, hash: string | undefined, code: string | undefined, type: string, more: Partial<AuthData> = {}): Outgoing => ({
    to: address,
    mail: authEmail(kind, { ...base, url: hash ? verifyUrl(u, hash, type, d.redirect_to) : u.appUrl, email: address, code: code || undefined, ...more }),
  });

  switch (d.email_action_type) {
    case "signup":
      return [make("confirm", to, d.token_hash, d.token, "signup")];
    case "magiclink":
      return [make("magic", to, d.token_hash, d.token, "magiclink")];
    case "recovery":
      return [make("recovery", to, d.token_hash, d.token, "recovery")];
    case "invite":
      return [make("invite", to, d.token_hash, d.token, "invite")];
    case "reauthentication":
      return [make("reauth", to, undefined, d.token, "reauthentication")];
    case "email_change": {
      // Supabase swaps these names: token_hash_new goes to the current address, token_hash to the new one.
      const next = p.user.new_email;
      const out: Outgoing[] = [];
      if (d.token_hash_new) out.push(make("email_change_old", to, d.token_hash_new, d.token_new, "email_change", { newEmail: next }));
      if (next && d.token_hash) out.push(make("email_change_new", next, d.token_hash, d.token, "email_change", { oldEmail: to }));
      return out;
    }
    default: {
      const detail = d.email ?? d.provider ?? d.factor_type ?? d.old_email;
      const mail = securityNoticeEmail(d.email_action_type, { email: to, detail, settingsUrl: `${u.appUrl}/settings`, resetUrl: u.appUrl });
      return mail ? [{ to, mail }] : [];
    }
  }
}

export type HookDeps = HookUrls & {
  /** SEND_EMAIL_HOOK_SECRET. */
  secret: string | undefined;
  /** Null when RESEND_API_KEY isn't set. */
  resend: ResendDeps | null;
  now?: number;
};

export type HookResult = { status: number; body: Record<string, unknown> };

const fail = (message: string, status = 401): HookResult => ({ status, body: { error: { http_code: status, message } } });

function isPayload(p: unknown): p is HookPayload {
  const o = p as HookPayload | null;
  return Boolean(o && typeof o.user?.email === "string" && o.user.email && typeof o.email_data?.email_action_type === "string");
}

export async function handleEmailHook(req: { headers: Headers; body: string }, d: HookDeps): Promise<HookResult> {
  if (!verifyWebhook(req.headers, req.body, d.secret, d.now)) return fail("Bad or missing signature.");
  if (!d.resend || !d.supabaseUrl) return fail("Email is not set up on the server.", 500);
  let p: unknown;
  try {
    p = JSON.parse(req.body);
  } catch {
    return fail("Bad body.", 400);
  }
  if (!isPayload(p)) return fail("Bad body.", 400);
  const id = req.headers.get("webhook-id");
  try {
    for (const m of emailsFor(p, d)) await sendBuilt([m.to], m.mail, d.resend, { idempotencyKey: `auth-${id}-${m.to}` });
  } catch (e) {
    return fail(`Couldn't send the email: ${e instanceof Error ? e.message : String(e)}`, 500);
  }
  return { status: 200, body: {} };
}
