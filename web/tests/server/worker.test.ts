// POST /api/worker with a fake database and fake partner APIs behind globalThis.fetch. Any other address fails the
// test, so nothing reaches Arrowsterr, Capybaroar or Supabase.
// Run with: node --conditions=react-server --test tests/server/*.test.ts (part of npm test).

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { register } from "node:module";
import { beforeEach, test } from "node:test";
import { fakeDb } from "./fakeDb.ts";
import { auth } from "./stubs/serverAuth.ts";

register("./tsResolve.mjs", import.meta.url);

// Fake settings, only for this test process.
const SECRET = "test-cron-secret-123";
process.env.CRON_SECRET = SECRET;
process.env.ARROWSTERR_PARTNER_URL = "https://aw.test";
process.env.ARROWSTERR_PARTNER_KEY = "aw_partner_test";
process.env.CAPYBAROAR_PARTNER_URL = "https://cb.test";
process.env.CAPYBAROAR_PARTNER_KEY = "cb_partner_test";
process.env.SEALING_KEYS = `t1:${randomBytes(32).toString("base64")}`;

const worker = await import("../../src/app/api/worker/route.ts");
const { open } = await import("../../src/lib/sealing.ts");

let brands: { host: string; id: string; external_id: string; name: string; domain: string | null }[];
let partnerCalls: string[];
/** A test can answer some calls itself. */
let answer: ((host: string, method: string, path: string) => Response | null) | null = null;

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (url.hostname !== "aw.test" && url.hostname !== "cb.test") throw new Error(`test tried to reach ${url.hostname}`);
  const key = url.hostname === "aw.test" ? "aw_partner_test" : "cb_partner_test";
  assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${key}`);
  const method = init?.method ?? "GET";
  partnerCalls.push(`${method} ${url.hostname}${url.pathname}`);
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
  const own = answer?.(url.hostname, method, url.pathname);
  if (own) return own;
  if (method === "POST" && url.pathname === "/api/partner/brands") {
    const body = JSON.parse(String(init?.body));
    const had = brands.find((b) => b.host === url.hostname && b.external_id === body.external_id);
    if (had) return json(200, had);
    const b = { host: url.hostname, id: `${url.hostname}-b${brands.length + 1}`, ...body };
    brands.push(b);
    return json(201, b);
  }
  const keys = url.pathname.match(/^\/api\/partner\/brands\/([^/]+)\/keys$/);
  if (keys && method === "POST") return json(201, { key: `${keys[1]}-secret-key`, prefix: `${keys[1]}-sec` });
  if (keys && method === "DELETE") return new Response(null, { status: 204 });
  return json(404, { error: { code: "not_found", message: "No such route." } });
}) as typeof fetch;

const WS = "11111111-2222-4333-8444-555555555555";
let db: ReturnType<typeof fakeDb>;
let claims: Record<string, unknown>[];

beforeEach(() => {
  answer = null;
  brands = [];
  partnerCalls = [];
  claims = [];
  db = fakeDb();
  db.tables.workspaces = [{ id: WS, name: "Ana's Bakery", website: "anasbakery.com" }];
  db.tables.services = [
    { workspace_id: WS, product: "arrowsterr", status: "pending" },
    { workspace_id: WS, product: "capybaroar", status: "pending" },
  ];
  db.tables.jobs = [
    { id: 1, kind: "provision", workspace_id: WS, payload: {}, attempts: 1, max_attempts: 5, locked_until: "2026-11-17T10:05:00Z" },
    { id: 2, kind: "send_rockets", workspace_id: null, payload: {}, attempts: 1, max_attempts: 5, locked_until: "2026-11-17T10:05:00Z" },
  ];
  db.rpcs.claim_jobs = (args) => {
    claims.push(args);
    return db.tables.jobs.map((j) => ({ ...j }));
  };
  auth.db = db;
});

const call = (headers: Record<string, string> = {}) => worker.POST(new Request("https://app.test/api/worker", { method: "POST", headers }));

test("a missing or wrong CRON_SECRET gets 401 and runs nothing", async () => {
  for (const h of [{}, { Authorization: "Bearer wrong" }, { Authorization: `Bearer ${SECRET}x` }, { Authorization: "Bearer " }, { Authorization: SECRET.slice(0, -1) }]) {
    const res = await call(h);
    assert.equal(res.status, 401, JSON.stringify(h));
    assert.deepEqual(await res.json(), { error: "Wrong or missing CRON_SECRET." });
  }
  assert.equal(claims.length, 0);
  assert.equal(partnerCalls.length, 0);
  assert.equal(db.writes.length, 0);
});

test("with no CRON_SECRET on the server, every call is refused", async () => {
  const was = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "";
  try {
    assert.equal((await call({ Authorization: "Bearer " })).status, 401);
    assert.equal((await call({ Authorization: "Bearer anything" })).status, 401);
  } finally {
    process.env.CRON_SECRET = was;
  }
  assert.equal(claims.length, 0);
});

test("the right secret claims due jobs, provisions both brands and fails an unknown kind clearly", async () => {
  const res = await call({ Authorization: `Bearer ${SECRET}` });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { claimed: 2, done: 1, retry: 0, failed: 1 });
  assert.deepEqual(claims, [{ n: 10, lease: "5 minutes" }]);

  for (const product of ["arrowsterr", "capybaroar"]) {
    const row = db.tables.services.find((s) => s.product === product)!;
    const host = product === "arrowsterr" ? "aw.test" : "cb.test";
    assert.equal(row.status, "ready");
    assert.equal(row.brand_id, brands.find((b) => b.host === host)!.id);
    assert.equal(open(String(row.sealed_key), `${WS}:${product}`), `${row.brand_id}-secret-key`);
    assert.equal(row.last_error, null);
  }
  assert.equal(brands.length, 2);
  assert.deepEqual(brands.map((b) => b.external_id), [WS, WS]);

  const [provisionJob, unknown] = db.tables.jobs;
  assert.ok(provisionJob.done_at);
  assert.equal(provisionJob.locked_until, null);
  assert.equal(unknown.done_at, undefined);
  assert.equal(unknown.attempts, 5);
  assert.equal(unknown.last_error, 'Unknown job kind "send_rockets".');
});

test("a second tick for the same workspace makes no second brand", async () => {
  await call({ Authorization: `Bearer ${SECRET}` });
  // Pretend the job came back (its row was lost) while the services are already ready.
  db.tables.jobs = [{ id: 3, kind: "provision", workspace_id: WS, payload: {}, attempts: 1, max_attempts: 5 }];
  const before = partnerCalls.length;
  const res = await call({ Authorization: `Bearer ${SECRET}` });
  assert.deepEqual(await res.json(), { claimed: 1, done: 1, retry: 0, failed: 0 });
  assert.equal(partnerCalls.length, before, "ready services are left alone");
  assert.equal(brands.length, 2);
});

test("a missing partner address fails that product with the reason and leaves the other ready", async () => {
  delete process.env.CAPYBAROAR_PARTNER_URL;
  try {
    db.tables.jobs = [db.tables.jobs[0]];
    const res = await call({ Authorization: `Bearer ${SECRET}` });
    // A missing address is a setting to fix, not a hiccup: the job stops and the service says why.
    assert.deepEqual(await res.json(), { claimed: 1, done: 0, retry: 0, failed: 1 });
    const cb = db.tables.services.find((s) => s.product === "capybaroar")!;
    assert.deepEqual([cb.status, cb.last_error], ["failed", "Capybaroar partner address is not set on the server."]);
    assert.equal(db.tables.services.find((s) => s.product === "arrowsterr")!.status, "ready");
  } finally {
    process.env.CAPYBAROAR_PARTNER_URL = "https://cb.test";
  }
});

test("no database settings or no 006_jobs.sql is a clear 500", async () => {
  auth.db = null;
  const res = await call({ Authorization: `Bearer ${SECRET}` });
  assert.equal(res.status, 500);
  assert.match((await res.json()).error, /SUPABASE_SECRET_KEY/);

  auth.db = db;
  delete db.rpcs.claim_jobs;
  const r2 = await call({ Authorization: `Bearer ${SECRET}` });
  assert.equal(r2.status, 500);
  assert.deepEqual(await r2.json(), { error: "Run supabase/006_jobs.sql in Supabase." });
});

test("Arrowsterr's 409 domain_taken alerts staff at once, even while Capybaroar's hiccup keeps the job retrying", async () => {
  answer = (host, method, path) => {
    if (host === "aw.test" && method === "POST" && path === "/api/partner/brands") return new Response(JSON.stringify({ error: { code: "domain_taken", message: "Another brand in this workspace already tracks anasbakery.com." } }), { status: 409 });
    if (host === "cb.test") return new Response(JSON.stringify({ error: { code: "unavailable", message: "Down." } }), { status: 503 });
    return null;
  };
  db.tables.jobs = [db.tables.jobs[0]];
  const logged: string[] = [];
  const was = console.error;
  console.error = (...a: unknown[]) => void logged.push(a.join(" "));
  try {
    const res = await call({ Authorization: `Bearer ${SECRET}` });
    assert.deepEqual(await res.json(), { claimed: 1, done: 0, retry: 1, failed: 0 });
  } finally {
    console.error = was;
  }
  const aw = db.tables.services.find((s) => s.product === "arrowsterr")!;
  assert.deepEqual([aw.status, aw.last_error], ["failed", "Another customer already tracks this website in SEO. We'll sort it out."]);
  assert.ok(logged.some((l) => l.startsWith(`Provision for workspace ${WS}: Another customer already tracks this website in SEO.`)), logged.join("\n"));
});

test("a workspace with no website: Arrowsterr waits, Capybaroar is made, the job is done", async () => {
  db.tables.workspaces[0].website = null;
  db.tables.jobs = [db.tables.jobs[0]];
  const res = await call({ Authorization: `Bearer ${SECRET}` });
  assert.deepEqual(await res.json(), { claimed: 1, done: 1, retry: 0, failed: 0 });
  assert.deepEqual(db.tables.services.map((s) => [s.product, s.status, s.last_error]), [["arrowsterr", "waiting", null], ["capybaroar", "ready", null]]);
  assert.ok(!partnerCalls.some((c) => c.includes("aw.test")), "no call to Arrowsterr");
  assert.equal(brands.find((b) => b.host === "cb.test")!.domain, null);
});
