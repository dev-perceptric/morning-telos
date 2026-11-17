// Password sign-in with Supabase and the database replaced by fakes. Nothing reaches a real server.
import assert from "node:assert/strict";
import test from "node:test";
import type { WrongTries } from "../src/lib/lockout.ts";
import { signIn, type SigninDeps } from "../src/lib/signin.ts";

function deps(reply: { status: number; body: Record<string, unknown> }, tries: WrongTries | null = null) {
  const calls: { url: string; body: unknown }[] = [];
  const recorded: { email: string; ip: string; ok: boolean }[] = [];
  const d: SigninDeps = {
    url: "https://db.example.test",
    key: "sb_publishable_test",
    ip: "5.5.5.5",
    fetch: (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch,
    wrongTries: async () => tries,
    record: async (email, ip, ok) => {
      recorded.push({ email, ip, ok });
    },
  };
  return { d, calls, recorded };
}
const OK = { status: 200, body: { access_token: "a", refresh_token: "r", user: { id: "x" } } };

test("rejects a missing email or password without calling Supabase", async () => {
  const { d, calls } = deps(OK);
  const r = await signIn({ email: "nope", password: "" }, d);
  assert.equal(r.status, 400);
  assert.equal(calls.length, 0);
});

test("passes the lowercased email and captcha token to Supabase, records the success and returns the tokens", async () => {
  const { d, calls, recorded } = deps(OK);
  const r = await signIn({ email: "Ana@Example.com", password: "pw-123456789", captchaToken: "tok" }, d);
  assert.deepEqual(r, { status: 200, body: { access_token: "a", refresh_token: "r" } });
  assert.equal(calls[0].url, "https://db.example.test/auth/v1/token?grant_type=password");
  assert.deepEqual(calls[0].body, { email: "ana@example.com", password: "pw-123456789", gotrue_meta_security: { captcha_token: "tok" } });
  assert.deepEqual(recorded, [{ email: "ana@example.com", ip: "5.5.5.5", ok: true }]);
});

test("a locked-out email never reaches Supabase", async () => {
  const { d, calls } = deps(OK, { pair: 5, ip: 5, emailHour: 5 });
  const r = await signIn({ email: "ana@example.com", password: "pw-123456789" }, d);
  assert.equal(r.status, 429);
  assert.equal(r.body.locked, true);
  assert.equal(calls.length, 0);
});

test("a wrong password is recorded and gets one message that doesn't say whether the account exists", async () => {
  const { d, recorded } = deps({ status: 400, body: { error: "invalid_grant", error_description: "Invalid login credentials" } });
  const r = await signIn({ email: "ana@example.com", password: "wrong-password" }, d);
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "Email or password is wrong.");
  assert.deepEqual(recorded, [{ email: "ana@example.com", ip: "5.5.5.5", ok: false }]);
});

test("an unconfirmed email gets told to confirm", async () => {
  const { d } = deps({ status: 400, body: { error_description: "Email not confirmed" } });
  assert.match(String((await signIn({ email: "ana@example.com", password: "pw-123456789" }, d)).body.error), /Confirm your email/);
});

test("a failed bot check asks to finish the security check", async () => {
  const { d } = deps({ status: 400, body: { msg: "captcha protection: request disallowed" } });
  assert.match(String((await signIn({ email: "ana@example.com", password: "pw-123456789" }, d)).body.error), /security check/);
});

test("says so when sign-in isn't set up on the server", async () => {
  const { d } = deps(OK);
  const r = await signIn({ email: "ana@example.com", password: "pw-123456789" }, { ...d, url: "" });
  assert.equal(r.status, 500);
});

test("a network failure gets a clear message", async () => {
  const { d } = deps(OK);
  const r = await signIn({ email: "ana@example.com", password: "pw-123456789" }, { ...d, fetch: (async () => { throw new Error("down"); }) as typeof fetch });
  assert.equal(r.status, 502);
});
