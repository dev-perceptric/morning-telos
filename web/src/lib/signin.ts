// Password sign-in, counted and locked out (copied from Arrowsterr's signin route). The route in
// src/app/api/auth/signin wires in the real database and fetch; tests pass fakes.
import { cleanEmail, isLocked, type WrongTries } from "./lockout.ts";

export type SigninDeps = {
  url: string;
  key: string;
  ip: string;
  fetch: typeof fetch;
  /** Wrong tries so far, or null when there's no database to count in. */
  wrongTries: (email: string, ip: string) => Promise<WrongTries | null>;
  record: (email: string, ip: string, ok: boolean) => Promise<void>;
};

export type SigninResult = { status: number; body: Record<string, unknown> };

const err = (error: string, status = 400, extra: Record<string, unknown> = {}): SigninResult => ({ status, body: { error, ...extra } });

export async function signIn(input: { email?: unknown; password?: unknown; captchaToken?: unknown }, d: SigninDeps): Promise<SigninResult> {
  const email = cleanEmail(input.email);
  const password = String(input.password ?? "").slice(0, 200);
  if (!email || !password) return err("Enter your email and password.");
  if (!d.url || !d.key) return err("Sign-in is not set up on the server.", 500);

  const tries = await d.wrongTries(email, d.ip);
  if (tries && isLocked(tries)) return err("Too many wrong tries. Wait 15 minutes, or reset your password.", 429, { locked: true });

  const captcha = typeof input.captchaToken === "string" && input.captchaToken ? { gotrue_meta_security: { captcha_token: input.captchaToken } } : {};
  const res = await d
    .fetch(`${d.url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: d.key, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, ...captcha }),
      signal: AbortSignal.timeout(15_000),
    })
    .catch(() => null);
  if (!res) return err("Couldn't reach the sign-in service. Try again.", 502);
  const out = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const said = String(out.error_description ?? out.msg ?? out.message ?? out.error ?? "");
  const wrong = !res.ok && !/captcha|confirm/i.test(said) && res.status !== 429;
  await d.record(email, d.ip, res.ok);
  if (!res.ok) {
    if (/confirm/i.test(said)) return err("Confirm your email first. Click the link we sent you, or use a sign-in code.");
    if (/captcha/i.test(said)) return err("Please finish the security check and try again.");
    if (res.status === 429) return err("Too many tries. Wait a few minutes and try again.", 429, { locked: true });
    return err(wrong ? "Email or password is wrong." : said || "Sign-in failed. Try again.");
  }
  return { status: 200, body: { access_token: out.access_token, refresh_token: out.refresh_token } };
}
