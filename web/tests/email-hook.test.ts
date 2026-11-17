// Supabase's Send Email hook with Resend replaced by a fake fetch. Signatures are real HMACs built here.
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import test from "node:test";
import { DEFAULT_FROM, RESEND_URL } from "../src/lib/email.ts";
import { emailsFor, handleEmailHook, HOOK_WINDOW, verifyWebhook, type HookDeps, type HookPayload } from "../src/lib/emailHook.ts";

const RAW = randomBytes(32).toString("base64");
const SECRET = `v1,whsec_${RAW}`;
const NOW = 1_800_000_000;
const urls = { supabaseUrl: "https://db.example.test", appUrl: "https://chat.example.test" };

function sign(id: string, ts: number, body: string, secret = RAW) {
  return `v1,${createHmac("sha256", Buffer.from(secret, "base64")).update(`${id}.${ts}.${body}`).digest("base64")}`;
}

function request(payload: unknown, o: { id?: string; ts?: number; sig?: string | null; secret?: string } = {}) {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  const id = o.id ?? "msg_abc123";
  const ts = o.ts ?? NOW;
  const headers = new Headers({ "webhook-id": id, "webhook-timestamp": String(ts) });
  const sig = o.sig === undefined ? sign(id, ts, body, o.secret) : o.sig;
  if (sig !== null) headers.set("webhook-signature", sig);
  return { headers, body };
}

function fakeResend(status = 200) {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), headers: Object.fromEntries(new Headers(init?.headers).entries()), body: JSON.parse(String(init?.body)) });
    return new Response(status === 200 ? '{"id":"e_1"}' : '{"message":"nope"}', { status });
  }) as typeof globalThis.fetch;
  const deps: HookDeps = { ...urls, secret: SECRET, now: NOW, resend: { key: "re_test", from: DEFAULT_FROM, fetch } };
  return { calls, deps };
}

const payload = (type: string, extra: Partial<HookPayload["email_data"]> = {}, user: Partial<HookPayload["user"]> = {}): HookPayload => ({
  user: { id: "u1", email: "ana@example.com", user_metadata: { name: "Ana Lopez", business: "Acme" }, ...user },
  email_data: { email_action_type: type, token: "123456", token_hash: "hash_main", redirect_to: "https://chat.example.test/welcome", site_url: "https://chat.example.test", ...extra },
});

test("rejects a missing signature", async () => {
  const { calls, deps } = fakeResend();
  const r = await handleEmailHook(request(payload("signup"), { sig: null }), deps);
  assert.equal(r.status, 401);
  assert.deepEqual(r.body, { error: { http_code: 401, message: "Bad or missing signature." } });
  assert.equal(calls.length, 0);
});

test("rejects a signature made with another secret, or over another body", async () => {
  const { calls, deps } = fakeResend();
  assert.equal((await handleEmailHook(request(payload("signup"), { secret: randomBytes(32).toString("base64") }), deps)).status, 401);
  const good = request(payload("signup"));
  assert.equal((await handleEmailHook({ headers: good.headers, body: good.body.replace("ana@", "eve@") }, deps)).status, 401);
  assert.equal((await handleEmailHook(request(payload("signup"), { sig: "v1,bm90IGEgc2lnbmF0dXJl" }), deps)).status, 401);
  assert.equal(calls.length, 0);
});

test("rejects a signature older or newer than 5 minutes", async () => {
  const { calls, deps } = fakeResend();
  assert.equal((await handleEmailHook(request(payload("signup"), { ts: NOW - HOOK_WINDOW - 1 }), deps)).status, 401);
  assert.equal((await handleEmailHook(request(payload("signup"), { ts: NOW + HOOK_WINDOW + 1 }), deps)).status, 401);
  assert.equal(calls.length, 0);
});

test("rejects everything when the server has no hook secret", async () => {
  const { deps } = fakeResend();
  assert.equal((await handleEmailHook(request(payload("signup")), { ...deps, secret: "" })).status, 401);
  assert.equal((await handleEmailHook(request(payload("signup")), { ...deps, secret: undefined })).status, 401);
});

test("accepts a correct signature, also among several, and with or without the v1,whsec_ prefix", () => {
  const r = request(payload("signup"));
  assert.ok(verifyWebhook(r.headers, r.body, SECRET, NOW));
  assert.ok(verifyWebhook(r.headers, r.body, `whsec_${RAW}`, NOW));
  assert.ok(verifyWebhook(r.headers, r.body, RAW, NOW + HOOK_WINDOW));
  r.headers.set("webhook-signature", `v1,c29tZXRoaW5nIGVsc2U= ${r.headers.get("webhook-signature")}`);
  assert.ok(verifyWebhook(r.headers, r.body, SECRET, NOW));
  r.headers.set("webhook-timestamp", "soon");
  assert.ok(!verifyWebhook(r.headers, r.body, SECRET, NOW));
});

test("a signed sign-up sends one confirm email through Resend, from meet@, with a key per webhook id", async () => {
  const { calls, deps } = fakeResend();
  const r = await handleEmailHook(request(payload("signup")), deps);
  assert.deepEqual(r, { status: 200, body: {} });
  assert.equal(calls.length, 1);
  const c = calls[0];
  assert.equal(c.url, RESEND_URL);
  assert.equal(c.headers.authorization, "Bearer re_test");
  assert.equal(c.headers["idempotency-key"], "auth-msg_abc123-ana@example.com");
  assert.equal(c.body.from, "Morning Telos <meet@morningtelos.com>");
  assert.deepEqual(c.body.to, ["ana@example.com"]);
  assert.equal(c.body.subject, "Confirm your email for Morning Telos");
  const link = "https://db.example.test/auth/v1/verify?token=hash_main&type=signup&redirect_to=https%3A%2F%2Fchat.example.test%2Fwelcome";
  assert.ok(String(c.body.html).includes(link.replace(/&/g, "&amp;")));
  assert.ok(String(c.body.text).includes(link));
  assert.match(String(c.body.text), /Or enter this code: 123456/);
  assert.match(String(c.body.html), /Welcome, Ana/);
});

test("picks the right email for each email_action_type", () => {
  const subject = (p: HookPayload) => emailsFor(p, urls).map((m) => [m.to, m.mail.subject]);
  assert.deepEqual(subject(payload("signup")), [["ana@example.com", "Confirm your email for Morning Telos"]]);
  assert.deepEqual(subject(payload("magiclink")), [["ana@example.com", "123456 is your Morning Telos login code"]]);
  assert.deepEqual(subject(payload("recovery")), [["ana@example.com", "Reset your Morning Telos password"]]);
  assert.deepEqual(subject(payload("invite", {}, { user_metadata: { invited_by_name: "Sam" } })), [["ana@example.com", "Sam invited you to Morning Telos"]]);
  assert.deepEqual(subject(payload("reauthentication")), [["ana@example.com", "123456 is your Morning Telos security code"]]);
  assert.deepEqual(subject(payload("password_changed_notification")), [["ana@example.com", "Your password was changed"]]);
  assert.deepEqual(subject(payload("identity_linked_notification", { provider: "google" })), [["ana@example.com", "A login method was added"]]);
  assert.deepEqual(subject(payload("mfa_factor_enrolled_notification")), [["ana@example.com", "2-step login was turned on"]]);
  assert.deepEqual(subject(payload("some_future_kind")), []);
});

test("each link uses the matching verify type, and falls back to the app when there's no redirect", () => {
  for (const [kind, type] of [["signup", "signup"], ["magiclink", "magiclink"], ["recovery", "recovery"], ["invite", "invite"]]) {
    const [m] = emailsFor(payload(kind, { redirect_to: "" }), urls);
    assert.ok(m.mail.text.includes(`https://db.example.test/auth/v1/verify?token=hash_main&type=${type}&redirect_to=https%3A%2F%2Fchat.example.test`), kind);
  }
  const [re] = emailsFor(payload("reauthentication"), urls);
  assert.doesNotMatch(re.mail.text, /auth\/v1\/verify/);
});

test("an invite ignores an inviter id that is only a uuid", () => {
  const [m] = emailsFor(payload("invite", {}, { user_metadata: { invited_by: "6f1c2a8e-1b2c-4d5e-8f90-123456789abc" } }), urls);
  assert.equal(m.mail.subject, "You're invited to Morning Telos");
});

test("a secure email change sends to both addresses with the swapped hashes", async () => {
  const { calls, deps } = fakeResend();
  const p = payload("email_change", { token: "222222", token_hash: "hash_for_new", token_new: "111111", token_hash_new: "hash_for_current" }, { new_email: "new@example.com" });
  const r = await handleEmailHook(request(p), deps);
  assert.equal(r.status, 200);
  assert.deepEqual(calls.map((c) => c.body.to), [["ana@example.com"], ["new@example.com"]]);
  assert.deepEqual(calls.map((c) => c.headers["idempotency-key"]), ["auth-msg_abc123-ana@example.com", "auth-msg_abc123-new@example.com"]);
  const [old, next] = calls.map((c) => String(c.body.text));
  assert.match(old, /token=hash_for_current&type=email_change/);
  assert.match(old, /: 111111/);
  assert.match(old, /from ana@example\.com to new@example\.com/);
  assert.match(next, /token=hash_for_new&type=email_change/);
  assert.match(next, /: 222222/);
  assert.match(next, /It replaces ana@example\.com/);
});

test("an email change without secure change sends only to the new address", () => {
  const p = payload("email_change", { token_hash: "hash_for_new" }, { new_email: "new@example.com" });
  assert.deepEqual(emailsFor(p, urls).map((m) => m.to), ["new@example.com"]);
});

test("fails with 500 when Resend isn't set up or says no, and 400 for a bad body", async () => {
  const { deps } = fakeResend(422);
  const bad = await handleEmailHook(request(payload("recovery")), deps);
  assert.equal(bad.status, 500);
  assert.match(String((bad.body.error as { message: string }).message), /Resend returned 422/);
  assert.equal((await handleEmailHook(request(payload("recovery")), { ...deps, resend: null })).status, 500);
  assert.equal((await handleEmailHook(request("{not json"), deps)).status, 400);
  assert.equal((await handleEmailHook(request({ user: {}, email_data: {} }), deps)).status, 400);
});
