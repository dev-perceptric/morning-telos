// Calls to the app (src/api.js) with a fake fetch: the bearer token, no cookies, retries for reads only.
import assert from "node:assert/strict";
import test from "node:test";
import { call } from "../src/api.js";

const auth = { token: "tok", app: "https://chat.morningtelos.com" };
const wait = async () => {};

test("sends the bearer token and never cookies", async () => {
  let seen;
  const r = await call(async (url, init) => ((seen = { url, init }), new Response(JSON.stringify({ count: 2 }))), auth, "/api/extension/approvals?workspaceId=w");
  assert.deepEqual(r, { ok: true, data: { count: 2 } });
  assert.equal(seen.url, "https://chat.morningtelos.com/api/extension/approvals?workspaceId=w");
  assert.equal(seen.init.headers.Authorization, "Bearer tok");
  assert.equal(seen.init.credentials, "omit");
});

test("a read is tried again after a hiccup; a change is sent once", async () => {
  let n = 0;
  const flaky = async () => (++n < 3 ? new Response("{}", { status: 503 }) : new Response(JSON.stringify({ ok: 1 })));
  assert.equal((await call(flaky, auth, "/x", { wait })).ok, true);
  assert.equal(n, 3);
  n = 0;
  const r = await call(flaky, auth, "/api/approvals/1", { method: "POST", body: { action: "approve" }, wait });
  assert.equal(n, 1);
  assert.equal(r.ok, false);
});

test("a 401 means signed out; other errors show the server's short line", async () => {
  assert.deepEqual(await call(async () => new Response(JSON.stringify({ error: "Please sign in again." }), { status: 401 }), auth, "/x", { wait }), { ok: false, status: 401, error: "Please sign in again.", signedOut: true });
  assert.equal((await call(async () => new Response(JSON.stringify({ error: "You need editor access in this workspace to do that." }), { status: 403 }), auth, "/x", { wait })).error, "You need editor access in this workspace to do that.");
  assert.equal((await call(async () => { throw new TypeError("offline"); }, auth, "/x", { wait })).error, "Couldn't reach Morning Telos. Check your connection and try again.");
  assert.equal((await call(fetch, null, "/x")).signedOut, true);
});
