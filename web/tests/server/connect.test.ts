// The connect routes (GET /api/social/networks, POST /api/social/connect/start, POST /api/connect/return,
// GET and POST /api/social/connect/pick/:token, and the SEO tool routes) with a fake database and a fake partner
// behind globalThis.fetch. Any other address fails the test, so nothing reaches Capybaroar, Arrowsterr or Supabase.
// Run with: node --conditions=react-server --test tests/server/*.test.ts (part of npm test).

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { register } from "node:module";
import { beforeEach, test } from "node:test";
import { fakeDb } from "./fakeDb.ts";
import { auth } from "./stubs/serverAuth.ts";

register("./tsResolve.mjs", import.meta.url);

// Fake settings, only for this test process.
process.env.CAPYBAROAR_PARTNER_URL = "https://cb.test";
process.env.CAPYBAROAR_PARTNER_KEY = "cb_partner_test";
process.env.ARROWSTERR_PARTNER_URL = "https://aw.test";
process.env.ARROWSTERR_PARTNER_KEY = "aw_partner_test";
process.env.SEALING_KEYS = `t1:${randomBytes(32).toString("base64")}`;
process.env.SEALING_KEY_CURRENT = "";
delete process.env.APP_URL;

const networks = await import("../../src/app/api/social/networks/route.ts");
const start = await import("../../src/app/api/social/connect/start/route.ts");
const back = await import("../../src/app/api/connect/return/route.ts");
const pick = await import("../../src/app/api/social/connect/pick/[token]/route.ts");
const tools = await import("../../src/app/api/seo/integrations/route.ts");
const toolStart = await import("../../src/app/api/seo/connect/start/route.ts");
const { RETURN_MESSAGES } = await import("../../src/lib/partnerConnect.ts");

const WS = "11111111-2222-4333-8444-555555555555";
const OTHER = "11111111-2222-4333-8444-666666666666";
let calls: string[];
/** Set to true to act like a Capybaroar without the new calls. */
let older = false;

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (url.hostname !== "cb.test" && url.hostname !== "aw.test") throw new Error(`test tried to reach ${url.hostname}`);
  const method = init?.method ?? "GET";
  calls.push(`${url.hostname} ${method} ${url.pathname}`);
  const j = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
  const p = url.pathname;
  if (url.hostname === "aw.test") {
    if (p === "/api/partner/integrations") return j(200, { integrations: [{ id: "google_search_console", name: "Google Search Console", kind: "seo" }] });
    if (p === "/api/partner/brands/aw-1/connect/start") return j(200, { url: "https://accounts.google.test/o" });
    return j(404, { error: { code: "not_found", message: "No." } });
  }
  if (p.match(/^\/api\/partner\/brands\/[^/]+\/connect-link$/)) return j(201, { url: "https://cb.test/connect/old", expires_at: null });
  if (older) return j(404, { error: { code: "not_found", message: "No." } });
  if (p === "/api/partner/networks") return j(200, { networks: [{ id: "linkedin", name: "LinkedIn", kind: "profile" }, { id: "facebook", name: "Facebook", kind: "page" }] });
  const s = p.match(/^\/api\/partner\/brands\/([^/]+)\/connect\/start$/);
  if (s && method === "POST") {
    const body = JSON.parse(String(init?.body));
    lastReturn = body.return_url;
    return j(200, { url: `https://www.${body.network}.test/oauth` });
  }
  if (p === "/api/partner/connect/pick/pick_tok_123" && method === "GET") return j(200, { network: "facebook", options: [{ id: "p1", name: "Ana's Bakery", picture: "https://cdn.test/a.png" }] });
  if (p === "/api/partner/connect/pick/pick_tok_123" && method === "POST") return j(200, { channels: [{ id: "ch1" }] });
  return j(404, { error: { code: "not_found", message: "No." } });
}) as typeof fetch;

let lastReturn = "";
let db: ReturnType<typeof fakeDb>;

beforeEach(() => {
  calls = [];
  older = false;
  lastReturn = "";
  db = fakeDb({});
  db.tables.services = [
    { workspace_id: WS, product: "arrowsterr", status: "ready", brand_id: "aw-1" },
    { workspace_id: WS, product: "capybaroar", status: "ready", brand_id: "cb-1" },
    { workspace_id: OTHER, product: "capybaroar", status: "ready", brand_id: "cb-2" },
  ];
  auth.db = db;
  auth.roles = new Map([
    [`admin1:${WS}`, "admin"],
    [`owner1:${WS}`, "owner"],
    [`editor1:${WS}`, "editor"],
    [`owner2:${OTHER}`, "owner"],
  ]);
});

const as = (user: string | null) => (user ? { Authorization: `Bearer ${user}` } : {});
const post = (path: string, user: string | null, body: unknown) => new Request(`https://app.test${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...as(user) }, body: JSON.stringify(body) });
const get = (path: string, user: string | null) => new Request(`https://app.test${path}`, { headers: as(user) });
const params = (token: string) => ({ params: Promise.resolve({ token }) });

async function started(user = "admin1", from: unknown = { to: "settings" }) {
  const res = await start.POST(post("/api/social/connect/start", user, { workspaceId: WS, network: "facebook", from }));
  assert.equal(res.status, 200);
  return new URL(lastReturn).searchParams.get("state")!;
}

test("networks: admins see the list; editors, other workspaces and signed-out people don't", async () => {
  const res = await networks.GET(get(`/api/social/networks?workspaceId=${WS}`, "admin1"));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { mode: "branded", networks: [{ id: "facebook", name: "Facebook", kind: "page" }, { id: "linkedin", name: "LinkedIn", kind: "profile" }] }, "in the logo order");
  assert.equal((await networks.GET(get(`/api/social/networks?workspaceId=${WS}`, "editor1"))).status, 403);
  assert.equal((await networks.GET(get(`/api/social/networks?workspaceId=${WS}`, "owner2"))).status, 403);
  assert.equal((await networks.GET(get(`/api/social/networks?workspaceId=${WS}`, null))).status, 401);
  assert.equal((await networks.GET(get("/api/social/networks", "admin1"))).status, 400);
  older = true;
  assert.deepEqual(await (await networks.GET(get(`/api/social/networks?workspaceId=${WS}`, "owner1"))).json(), { mode: "link", networks: [] });
});

test("start: the network's sign-in for this workspace's brand, coming back to our return page", async () => {
  const res = await start.POST(post("/api/social/connect/start", "admin1", { workspaceId: WS, network: "linkedin", from: { to: "home" } }));
  assert.deepEqual(await res.json(), { mode: "branded", url: "https://www.linkedin.test/oauth" });
  assert.deepEqual(calls, ["cb.test GET /api/partner/networks", "cb.test POST /api/partner/brands/cb-1/connect/start"]);
  assert.match(lastReturn, /^https:\/\/app\.test\/settings\/social\/return\?state=v2\./);
  assert.equal((await start.POST(post("/api/social/connect/start", "editor1", { workspaceId: WS, network: "linkedin" }))).status, 403);
  assert.equal((await start.POST(post("/api/social/connect/start", "admin1", { workspaceId: WS, network: "myspace" }))).status, 400);
  older = true;
  assert.deepEqual(await (await start.POST(post("/api/social/connect/start", "admin1", { workspaceId: WS }))).json(), { mode: "link", url: "https://cb.test/connect/old" });
});

test("return: the person who started it sees the view; anyone else is refused", async () => {
  const state = await started("admin1", { to: "chat", thread: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", agent: "social" });
  const res = await back.POST(post("/api/connect/return", "admin1", { state, query: { cb_status: "connected", network: "facebook" } }));
  assert.equal(res.status, 200);
  const out = (await res.json()) as { workspaceId: string; view: { title: string; back: string; chat: boolean } };
  assert.equal(out.workspaceId, WS);
  assert.deepEqual([out.view.title, out.view.back, out.view.chat], ["Facebook connected", "/chat/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", true]);
  assert.equal((await back.POST(post("/api/connect/return", "owner1", { state, query: {} }))).status, 403, "another admin of the same workspace");
  assert.equal((await back.POST(post("/api/connect/return", "owner2", { state, query: {} }))).status, 403, "another workspace's owner");
  assert.deepEqual(await (await back.POST(post("/api/connect/return", "admin1", { state, workspaceId: OTHER, query: {} }))).json(), { error: RETURN_MESSAGES.wrongWorkspace });
  assert.deepEqual(await (await back.POST(post("/api/connect/return", "admin1", { state: state.replace(/\.[^.]+$/, ".AAAA"), query: {} }))).json(), { error: RETURN_MESSAGES.expired });
});

test("pick: the options, then connect the picked ones, only for the person who started it", async () => {
  const state = await started();
  const q = new URLSearchParams({ state, workspaceId: WS });
  const res = await pick.GET(get(`/api/social/connect/pick/pick_tok_123?${q}`, "admin1"), params("pick_tok_123"));
  assert.deepEqual(await res.json(), { network: "facebook", name: "Facebook", options: [{ id: "p1", name: "Ana's Bakery", picture: "https://cdn.test/a.png" }] });
  assert.equal((await pick.GET(get(`/api/social/connect/pick/pick_tok_123?${q}`, "owner1"), params("pick_tok_123"))).status, 403);
  const saved = await pick.POST(post("/api/social/connect/pick/pick_tok_123", "admin1", { state, workspaceId: WS, ids: ["p1"] }), params("pick_tok_123"));
  assert.equal(saved.status, 200);
  assert.equal(((await saved.json()) as { view: { title: string } }).view.title, "Facebook connected");
  assert.equal((await pick.POST(post("/api/social/connect/pick/pick_tok_123", "admin1", { state, workspaceId: WS, ids: ["p7"] }), params("pick_tok_123"))).status, 400);
  assert.equal(calls.filter((c) => c === "cb.test POST /api/partner/connect/pick/pick_tok_123").length, 1, "an id that wasn't offered never reaches the partner");
});

test("SEO tools: the list and the start go to Arrowsterr, owners and admins only", async () => {
  assert.equal(((await (await tools.GET(get(`/api/seo/integrations?workspaceId=${WS}`, "owner1"))).json()) as { mode: string }).mode, "branded");
  const res = await toolStart.POST(post("/api/seo/connect/start", "owner1", { workspaceId: WS, integration: "google_search_console" }));
  assert.deepEqual(await res.json(), { mode: "branded", url: "https://accounts.google.test/o" });
  assert.deepEqual(calls.slice(-2), ["aw.test GET /api/partner/integrations", "aw.test POST /api/partner/brands/aw-1/connect/start"]);
  assert.equal((await toolStart.POST(post("/api/seo/connect/start", "editor1", { workspaceId: WS, integration: "google_search_console" }))).status, 403);
});
