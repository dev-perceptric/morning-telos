// Email links coming back to the app, and the quick log out (src/lib/authLinks.ts). No network: fakes only.
import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanLink, LINK_NOTICES, quickSignOut, readLink } from "../src/lib/authLinks.ts";

test("readLink: tokens in the hash, a code in the query, an error in either, or nothing", () => {
  assert.deepEqual(readLink("#access_token=a.b.c&expires_in=3600&refresh_token=r1&token_type=bearer&type=signup", ""), { kind: "tokens", access_token: "a.b.c", refresh_token: "r1" });
  assert.deepEqual(readLink("", "?code=abc"), { kind: "code" });
  assert.deepEqual(readLink("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired", ""), { kind: "error", notice: LINK_NOTICES.expired });
  assert.deepEqual(readLink("", "?error=server_error&error_description=Something"), { kind: "error", notice: LINK_NOTICES.failed });
  assert.equal(readLink("#access_token=only", ""), null, "both tokens or nothing");
  assert.equal(readLink("#signup", ""), null, "the site's sign-up link isn't an email link");
  assert.equal(readLink("", ""), null);
});

test("cleanLink drops the link's parts and keeps the page and other query", () => {
  assert.equal(cleanLink("/", "?code=abc"), "/");
  assert.equal(cleanLink("/settings", "?code=abc&tab=x"), "/settings?tab=x");
  assert.equal(cleanLink("/", "?error=x&error_code=y&error_description=z"), "/");
});

test("quickSignOut: logs out here first, then ends the session with Auth in the background", async () => {
  const order: string[] = [];
  const sent: { url: string; init: RequestInit }[] = [];
  const auth = {
    getSession: async () => ({ data: { session: { access_token: "tok" } } }),
    signOut: async (o: { scope: "local" }) => {
      order.push(`signOut:${o.scope}`);
    },
  };
  await quickSignOut(auth, {
    url: "https://db.test/",
    key: "anon",
    fetch: async (url, init) => {
      order.push("fetch");
      sent.push({ url, init });
      return new Response(null, { status: 204 });
    },
  });
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(order, ["signOut:local", "fetch"]);
  assert.equal(sent[0].url, "https://db.test/auth/v1/logout?scope=global");
  assert.equal((sent[0].init.headers as Record<string, string>).Authorization, "Bearer tok");
  assert.equal(sent[0].init.keepalive, true);
});

test("quickSignOut: no session means nothing to send, and a failed call never throws", async () => {
  let calls = 0;
  await quickSignOut({ getSession: async () => ({ data: { session: null } }), signOut: async () => {} }, { url: "https://db.test", key: "k", fetch: async () => (calls++, null) });
  assert.equal(calls, 0);
  await quickSignOut({ getSession: async () => ({ data: { session: { access_token: "t" } } }), signOut: async () => {} }, { url: "https://db.test", key: "k", fetch: async () => Promise.reject(new Error("offline")) });
  await new Promise((r) => setTimeout(r, 0));
});
