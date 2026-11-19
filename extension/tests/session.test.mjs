// This browser's sign-in (src/session.js) with fake storage and a fake Supabase. Nothing reaches the network.
import assert from "node:assert/strict";
import test from "node:test";
import { origins } from "../src/config.js";
import { makeSession, needsRefresh, validHandover } from "../src/session.js";

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSJ9.c2ln";
const allowed = { apps: ["https://chat.morningtelos.com"], dbs: ["https://db.morningtelos.com"] };
const handover = (o = {}) => ({
  type: "morningtelos-extension-session",
  session: { access_token: JWT, refresh_token: "r1abcdefgh", expires_at: 2_000_000_000 },
  supabaseUrl: "https://db.morningtelos.com",
  publishableKey: "sb_publishable_abcdefghijkl",
  app: "https://chat.morningtelos.com",
  ...o,
});

function fakeStorage(start = {}) {
  const data = { ...start };
  return {
    data,
    get: async (keys) => Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]])),
    set: async (o) => void Object.assign(data, o),
    remove: async (keys) => void keys.forEach((k) => delete data[k]),
  };
}

test("validHandover takes a whole session only from the app's own page", () => {
  const ok = validHandover(handover(), "https://chat.morningtelos.com", allowed);
  assert.deepEqual(ok, { access_token: JWT, refresh_token: "r1abcdefgh", expires_at: 2_000_000_000, supabaseUrl: "https://db.morningtelos.com", publishableKey: "sb_publishable_abcdefghijkl", app: "https://chat.morningtelos.com" });
  assert.equal(validHandover(handover(), "https://evil.example", allowed), null, "another site");
  assert.equal(validHandover(handover({ app: "https://evil.example" }), "https://chat.morningtelos.com", allowed), null);
  assert.equal(validHandover(handover({ supabaseUrl: "https://evil.example" }), "https://chat.morningtelos.com", allowed), null, "tokens never go to another server");
  assert.equal(validHandover(handover({ session: { access_token: "nope", refresh_token: "r1abcdefgh", expires_at: 1 } }), "https://chat.morningtelos.com", allowed), null);
  assert.equal(validHandover(handover({ publishableKey: "sb_secret_abc" }), "https://chat.morningtelos.com", allowed), null);
  assert.equal(validHandover(null, "https://chat.morningtelos.com", allowed), null);
});

test("origins come from the manifest: the store build allows only the live app", async () => {
  const { default: manifest } = await import("../manifest.json", { with: { type: "json" } });
  assert.deepEqual(origins(manifest), allowed);
  assert.deepEqual(origins({ host_permissions: [...manifest.host_permissions, "http://localhost:3000/*"] }).apps, ["https://chat.morningtelos.com", "http://localhost:3000"]);
});

test("needsRefresh: a minute before the token runs out", () => {
  assert.equal(needsRefresh({ expires_at: 1000 }, 900_000), false);
  assert.equal(needsRefresh({ expires_at: 1000 }, 950_000), true);
  assert.equal(needsRefresh(null), true);
});

test("token: a fresh token is used as is; an old one is refreshed once with Supabase, the way the app does", async () => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    await new Promise((r) => setTimeout(r, 5));
    return new Response(JSON.stringify({ access_token: `${JWT}x`, refresh_token: "r2abcdefgh", expires_at: 5000 }), { status: 200 });
  };
  const storage = fakeStorage({ auth: { ...validHandover(handover(), "https://chat.morningtelos.com", allowed), expires_at: 1000 } });
  const s = makeSession({ storage, fetch, now: () => 990_000 });
  const [a, b] = await Promise.all([s.token(), s.token()]);
  assert.deepEqual(a, { token: `${JWT}x`, app: "https://chat.morningtelos.com" });
  assert.deepEqual(b, a);
  assert.equal(calls.length, 1, "one refresh even when asked twice");
  assert.equal(calls[0].url, "https://db.morningtelos.com/auth/v1/token?grant_type=refresh_token");
  assert.equal(calls[0].init.headers.apikey, "sb_publishable_abcdefghijkl");
  assert.deepEqual(JSON.parse(calls[0].init.body), { refresh_token: "r1abcdefgh" });
  assert.equal(storage.data.auth.refresh_token, "r2abcdefgh");
  assert.deepEqual(await s.token(), a);
  assert.equal(calls.length, 1);
});

test("a refused refresh signs this browser out and clears what it stored", async () => {
  const storage = fakeStorage({ auth: { ...validHandover(handover(), "https://chat.morningtelos.com", allowed), expires_at: 1 }, workspaceId: "w", threads: {} });
  const s = makeSession({ storage, fetch: async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }), now: () => 10_000 });
  assert.equal(await s.token(), null);
  assert.deepEqual(storage.data, {});
});

test("a network failure during refresh keeps the session and says so", async () => {
  const storage = fakeStorage({ auth: { ...validHandover(handover(), "https://chat.morningtelos.com", allowed), expires_at: 1 } });
  const s = makeSession({ storage, fetch: async () => { throw new TypeError("offline"); }, now: () => 10_000 });
  await assert.rejects(s.token(), /Couldn't reach Morning Telos/);
  assert.ok(storage.data.auth);
});

test("signOut ends this browser's session with Supabase and clears everything", async () => {
  const calls = [];
  const storage = fakeStorage({ auth: validHandover(handover(), "https://chat.morningtelos.com", allowed), workspaceId: "w", threads: { w: "t" } });
  const s = makeSession({ storage, fetch: async (url, init) => (calls.push({ url, init }), new Response(null, { status: 204 })) });
  await s.signOut();
  assert.equal(calls[0].url, "https://db.morningtelos.com/auth/v1/logout?scope=local");
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${JWT}`);
  assert.deepEqual(storage.data, {});
  assert.equal(await s.token(), null);
});

test("signOut still clears when Supabase can't be reached", async () => {
  const storage = fakeStorage({ auth: validHandover(handover(), "https://chat.morningtelos.com", allowed) });
  await makeSession({ storage, fetch: async () => { throw new TypeError("offline"); } }).signOut();
  assert.deepEqual(storage.data, {});
});
