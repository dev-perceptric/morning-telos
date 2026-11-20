// POST /api/social/connect-link and POST /api/partner/capybaroar/webhook with a fake database and a fake Capybaroar
// behind globalThis.fetch. Any other address fails the test, so nothing reaches Capybaroar or Supabase.
// Run with: node --conditions=react-server --test tests/server/*.test.ts (part of npm test).

import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { register } from "node:module";
import { beforeEach, test } from "node:test";
import { fakeDb } from "./fakeDb.ts";
import { auth } from "./stubs/serverAuth.ts";

register("./tsResolve.mjs", import.meta.url);

// Fake settings, only for this test process.
const RAW = randomBytes(32).toString("base64");
process.env.CAPYBAROAR_PARTNER_URL = "https://cb.test";
process.env.CAPYBAROAR_PARTNER_KEY = "cb_partner_test";
process.env.CAPYBAROAR_WEBHOOK_SECRET = `whsec_${RAW}`;

const connect = await import("../../src/app/api/social/connect-link/route.ts");
const webhook = await import("../../src/app/api/partner/capybaroar/webhook/route.ts");
const { CONNECT_MESSAGES } = await import("../../src/lib/social.ts");

const WS = "11111111-2222-4333-8444-555555555555";
const OTHER = "11111111-2222-4333-8444-666666666666";
let partnerCalls: string[];

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (url.hostname !== "cb.test") throw new Error(`test tried to reach ${url.hostname}`);
  assert.equal(new Headers(init?.headers).get("authorization"), "Bearer cb_partner_test");
  partnerCalls.push(`${init?.method} ${url.pathname}`);
  const m = url.pathname.match(/^\/api\/partner\/brands\/([^/]+)\/connect-link$/);
  if (m && init?.method === "POST") return new Response(JSON.stringify({ url: `https://cb.test/connect/for-${m[1]}`, expires_at: "2026-11-18T10:00:00Z" }), { status: 201 });
  return new Response(JSON.stringify({ error: { code: "not_found", message: "No." } }), { status: 404 });
}) as typeof fetch;

let db: ReturnType<typeof fakeDb>;

beforeEach(() => {
  partnerCalls = [];
  db = fakeDb({ webhook_events: ["source", "id"] });
  db.tables.services = [
    { workspace_id: WS, product: "arrowsterr", status: "ready", brand_id: "aw-1" },
    { workspace_id: WS, product: "capybaroar", status: "ready", brand_id: "cb-1" },
    { workspace_id: OTHER, product: "capybaroar", status: "pending", brand_id: null },
  ];
  db.tables.social_channels = [];
  // The same rule as save_social_channel() in 007_social.sql: an older event never replaces a newer one.
  db.rpcs.save_social_channel = (a) => {
    const rows = db.tables.social_channels;
    const had = rows.find((r) => r.workspace_id === a.p_ws && r.channel_id === a.p_channel);
    if (had && String(had.updated_at) > String(a.p_at)) return false;
    const row = { workspace_id: a.p_ws, channel_id: a.p_channel, network: a.p_network, name: a.p_name, status: a.p_status, updated_at: a.p_at };
    if (had) Object.assign(had, row);
    else rows.push(row);
    return true;
  };
  auth.db = db;
  auth.roles = new Map([
    [`admin1:${WS}`, "admin"],
    [`editor1:${WS}`, "editor"],
    [`viewer1:${WS}`, "viewer"],
    [`owner2:${OTHER}`, "owner"],
  ]);
});

const ask = (user: string | null, workspaceId: unknown = WS) =>
  connect.POST(new Request("https://app.test/api/social/connect-link", { method: "POST", headers: user ? { Authorization: `Bearer ${user}` } : {}, body: JSON.stringify({ workspaceId }) }));

test("connect-link: an admin gets the link for their workspace's Capybaroar brand", async () => {
  const res = await ask("admin1");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { url: "https://cb.test/connect/for-cb-1", expires_at: "2026-11-18T10:00:00Z" });
  assert.deepEqual(partnerCalls, ["POST /api/partner/brands/cb-1/connect-link"]);
});

test("connect-link: editors, viewers, strangers and signed-out people get no link", async () => {
  assert.equal((await ask("editor1")).status, 403);
  assert.equal((await ask("viewer1")).status, 403);
  assert.equal((await ask("owner2")).status, 403, "an owner of another workspace");
  assert.equal((await ask(null)).status, 401);
  assert.equal((await ask("admin1", "")).status, 400);
  assert.deepEqual(partnerCalls, []);
});

test("connect-link: a workspace still being set up gets the not-ready message", async () => {
  const res = await ask("owner2", OTHER);
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), { error: CONNECT_MESSAGES.pending });
  assert.deepEqual(partnerCalls, []);
});

// ─────────────── webhook ───────────────

function deliver(payload: unknown, o: { id?: string; ts?: number; raw?: string; sig?: string | null } = {}) {
  const body = JSON.stringify(payload);
  const id = o.id ?? "msg_1";
  const ts = o.ts ?? Math.floor(Date.now() / 1000);
  const headers: Record<string, string> = { "webhook-id": id, "webhook-timestamp": String(ts) };
  const sig = o.sig === undefined ? `v1,${createHmac("sha256", Buffer.from(o.raw ?? RAW, "base64")).update(`${id}.${ts}.${body}`).digest("base64")}` : o.sig;
  if (sig !== null) headers["webhook-signature"] = sig;
  return webhook.POST(new Request("https://app.test/api/partner/capybaroar/webhook", { method: "POST", headers, body }));
}
const connected = (o: { brand_id?: string; external_id?: string; at?: string; type?: string } = {}) => ({
  type: o.type ?? "channel.connected",
  timestamp: o.at ?? "2027-01-15T08:00:00.000Z",
  data: { brand_id: o.brand_id ?? "cb-1", external_id: o.external_id ?? WS, channel: { id: "ch_9", network: "facebook", name: "Ana's Bakery" } },
});

test("webhook: a signed channel.connected saves the channel once, and a resend of the same id is skipped", async () => {
  const res = await deliver(connected());
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { received: true, changed: true });
  assert.deepEqual(db.tables.social_channels, [{ workspace_id: WS, channel_id: "ch_9", network: "facebook", name: "Ana's Bakery", status: "connected", updated_at: "2027-01-15T08:00:00.000Z" }]);
  assert.deepEqual(db.tables.webhook_events, [{ source: "capybaroar", id: "msg_1", type: "channel.connected" }]);

  const again = await deliver(connected());
  assert.deepEqual(await again.json(), { received: true, duplicate: true });
  assert.equal(db.writes.filter((w) => w.table === "webhook_events").length, 2);

  const lost = await deliver(connected({ type: "channel.lost", at: "2027-01-16T08:00:00.000Z" }), { id: "msg_2" });
  assert.equal(lost.status, 200);
  assert.equal(db.tables.social_channels[0].status, "lost");
});

test("webhook: bad, old or missing signatures are refused and nothing is written", async () => {
  assert.equal((await deliver(connected(), { sig: null })).status, 401);
  assert.equal((await deliver(connected(), { raw: randomBytes(32).toString("base64") })).status, 401);
  assert.equal((await deliver(connected(), { ts: Math.floor(Date.now() / 1000) - 3600 })).status, 401);
  assert.equal(db.writes.length, 0);
});

test("webhook: a channel whose brand belongs to another workspace is refused", async () => {
  const res = await deliver(connected({ brand_id: "cb-1", external_id: OTHER }));
  assert.equal(res.status, 403);
  const res2 = await deliver(connected({ brand_id: "cb-other", external_id: WS }), { id: "msg_x" });
  assert.equal(res2.status, 403);
  assert.equal(db.writes.length, 0);
});

test("webhook: a failed save takes the mark off so the resend runs", async () => {
  db.rpcs.save_social_channel = () => {
    throw new Error("boom");
  };
  const res = await deliver(connected());
  assert.equal(res.status, 500);
  assert.deepEqual(db.tables.webhook_events, []);
});
