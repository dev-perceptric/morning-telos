// Connecting social accounts (src/lib/social.ts): the connect link and Capybaroar's channel webhook, with fakes for
// the gate, the services row, the partner and the tables. Signatures are real HMACs built here. No network.
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import test from "node:test";
import type { Partner, PartnerFailure, PartnerResult, ConnectLink } from "../src/lib/partner.ts";
import type { ServiceStatus } from "../src/lib/provision.ts";
import { CONNECT_MESSAGES, connectLink, handleSocialWebhook, readChannelEvent, type ChannelRow, type WebhookDeps } from "../src/lib/social.ts";
import { networkName, sortChannels } from "../src/lib/socialChannels.ts";
import { ROLE_RANK, type Role } from "../src/lib/workspace.ts";
import type { Gate } from "../src/lib/workspaceRoutes.ts";

const WS = "7b1f3c9e-0000-4000-8000-000000000001";
const OTHER_WS = "7b1f3c9e-0000-4000-8000-000000000002";

function gateAs(role: Role | null, asked: Role[] = []): Gate {
  return async (min) => {
    asked.push(min);
    if (!role || ROLE_RANK[role] < ROLE_RANK[min]) return { ok: false, status: 403, error: `You need ${min} access in this workspace to do that.` };
    return { ok: true, userId: "me", email: "me@example.com" };
  };
}

function fakePartner(answer: PartnerResult<ConnectLink> = { ok: true, status: 201, data: { url: "https://cb.test/connect/tok123", expires_at: "2026-11-18T10:00:00Z" } }) {
  const calls: string[] = [];
  const no = async () => ({ ok: false, status: 500, code: "x", message: "not used", retryable: false }) as PartnerFailure;
  const partner: Partner = {
    product: "capybaroar",
    createBrand: no,
    createKey: no,
    revokeKeys: no,
    removeBrand: no,
    async connectLink(brand) {
      calls.push(brand);
      return answer;
    },
  };
  return { partner, calls };
}

function connectDeps(o: { role?: Role | null; service?: { status: ServiceStatus; brand_id: string | null } | null; partner?: ReturnType<typeof fakePartner> | { error: string } } = {}) {
  const asked: Role[] = [];
  const logs: string[] = [];
  const p = o.partner ?? fakePartner();
  return {
    asked,
    logs,
    p,
    d: {
      gate: gateAs(o.role === undefined ? "editor" : o.role, asked),
      service: async () => (o.service === undefined ? { status: "ready" as ServiceStatus, brand_id: "cb-brand-1" } : o.service),
      partner: () => ("error" in p ? { ok: false as const, error: p.error } : { ok: true as const, partner: p.partner }),
      log: (m: string) => void logs.push(m),
    },
  };
}

// ─────────────── connect link ───────────────

test("connect link: an editor, admin or owner gets the link for their workspace's brand", async () => {
  for (const role of ["editor", "admin", "owner"] as const) {
    const { d, asked, p } = connectDeps({ role });
    const r = await connectLink(d);
    assert.equal(r.status, 200, role);
    assert.deepEqual(r.body, { url: "https://cb.test/connect/tok123", expires_at: "2026-11-18T10:00:00Z" });
    assert.deepEqual(asked, ["editor"]);
    assert.deepEqual("calls" in p ? p.calls : null, ["cb-brand-1"]);
  }
});

test("connect link: a viewer or a non-member gets no link, and the partner is never called", async () => {
  for (const role of ["viewer", null] as const) {
    const { d, p } = connectDeps({ role });
    const r = await connectLink(d);
    assert.equal(r.status, 403);
    assert.deepEqual(r.body, { error: "You need editor access in this workspace to do that." });
    assert.deepEqual("calls" in p ? p.calls : null, []);
  }
});

test("connect link: setup that isn't ready yet gets a clear message, not a link", async () => {
  const cases: [{ status: ServiceStatus; brand_id: string | null } | null, string][] = [
    [null, CONNECT_MESSAGES.pending],
    [{ status: "pending", brand_id: null }, CONNECT_MESSAGES.pending],
    [{ status: "failed", brand_id: null }, CONNECT_MESSAGES.failed],
    [{ status: "ready", brand_id: null }, CONNECT_MESSAGES.failed],
    [{ status: "removing", brand_id: "cb-brand-1" }, CONNECT_MESSAGES.off],
    [{ status: "removed", brand_id: "cb-brand-1" }, CONNECT_MESSAGES.off],
  ];
  for (const [service, error] of cases) {
    const { d, p } = connectDeps({ service });
    const r = await connectLink(d);
    assert.equal(r.status, 409, JSON.stringify(service));
    assert.deepEqual(r.body, { error });
    assert.deepEqual("calls" in p ? p.calls : null, []);
  }
  assert.match(CONNECT_MESSAGES.pending, /Try again in a minute/);
});

test("connect link: a missing partner key or a partner problem shows plain words, and staff get the detail", async () => {
  const off = connectDeps({ partner: { error: "Capybaroar partner key is not set on the server." } });
  const r1 = await connectLink(off.d);
  assert.deepEqual([r1.status, r1.body], [503, { error: CONNECT_MESSAGES.notOpen }]);
  assert.match(off.logs[0], /partner key is not set/);

  const down = connectDeps({ partner: fakePartner({ ok: false, status: 503, code: "unavailable", message: "Down for a bit.", retryable: true }) });
  const r2 = await connectLink(down.d);
  assert.deepEqual([r2.status, r2.body], [503, { error: CONNECT_MESSAGES.busy }]);

  const refused = connectDeps({ partner: fakePartner({ ok: false, status: 403, code: "forbidden", message: "Not your brand.", retryable: false }) });
  const r3 = await connectLink(refused.d);
  assert.deepEqual([r3.status, r3.body], [502, { error: CONNECT_MESSAGES.broken }]);
  assert.match(refused.logs[0], /cb-brand-1 failed: 403 forbidden Not your brand\./);
  assert.doesNotMatch(JSON.stringify(r3.body), /forbidden|Not your brand/);
});

// ─────────────── webhook ───────────────

const RAW = randomBytes(32).toString("base64");
const SECRET = `whsec_${RAW}`;
const NOW = 1_800_000_000;

const sign = (id: string, ts: number, body: string, raw = RAW) => `v1,${createHmac("sha256", Buffer.from(raw, "base64")).update(`${id}.${ts}.${body}`).digest("base64")}`;

const event = (type: string, o: { brand_id?: string; external_id?: string; channel?: Record<string, unknown>; timestamp?: string } = {}) => ({
  type,
  timestamp: o.timestamp ?? "2027-01-15T08:00:00.000Z",
  data: { brand_id: o.brand_id ?? "cb-brand-1", external_id: o.external_id ?? WS, channel: o.channel ?? { id: "ch_1", network: "instagram", name: "@anasbakery" } },
});

function request(payload: unknown, o: { id?: string; ts?: number; sig?: string | null; raw?: string } = {}) {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  const id = o.id ?? "msg_1";
  const ts = o.ts ?? NOW;
  const headers = new Headers({ "webhook-id": id, "webhook-timestamp": String(ts) });
  const sig = o.sig === undefined ? sign(id, ts, body, o.raw) : o.sig;
  if (sig !== null) headers.set("webhook-signature", sig);
  return { headers, body };
}

function hookWorld(o: { secret?: string; saveFails?: boolean } = {}) {
  const brands = new Map([
    [WS, "cb-brand-1"],
    [OTHER_WS, "cb-brand-2"],
  ]);
  const seen = new Set<string>();
  const rows = new Map<string, ChannelRow>();
  const logs: string[] = [];
  let failSave = Boolean(o.saveFails);
  const d: WebhookDeps = {
    secret: o.secret === undefined ? SECRET : o.secret,
    now: NOW,
    brandOf: async (ws) => brands.get(ws) ?? null,
    markSeen: async (id) => (seen.has(id) ? false : (seen.add(id), true)),
    unmark: async (id) => void seen.delete(id),
    save: async (row) => {
      if (failSave) {
        failSave = false;
        throw new Error("connection reset");
      }
      const key = `${row.workspace_id}:${row.channel_id}`;
      const had = rows.get(key);
      if (had && had.updated_at > row.updated_at) return false;
      rows.set(key, row);
      return true;
    },
    log: (m) => void logs.push(m),
  };
  return { d, seen, rows, logs };
}

test("webhook: a missing, wrong, made-up or old signature is refused and nothing is written", async () => {
  const w = hookWorld();
  const e = event("channel.connected");
  const body = JSON.stringify(e);
  const bad = [
    request(e, { sig: null }),
    request(e, { raw: randomBytes(32).toString("base64") }),
    request(e, { sig: "v1,bm90IGEgc2lnbmF0dXJl" }),
    request(e, { sig: sign("msg_1", NOW, body).replace("v1,", "v2,") }),
    request(e, { ts: NOW - 301 }),
    request(e, { ts: NOW + 301 }),
    { headers: request(e).headers, body: body.replace("instagram", "facebook") },
  ];
  for (const r of bad) {
    const out = await handleSocialWebhook(r, w.d);
    assert.equal(out.status, 401);
    assert.deepEqual(out.body, { error: "Bad or missing signature." });
  }
  const noId = request(e);
  noId.headers.delete("webhook-id");
  assert.equal((await handleSocialWebhook(noId, w.d)).status, 401);
  assert.equal(w.seen.size, 0);
  assert.equal(w.rows.size, 0);
  // Inside the 5 minutes is fine.
  assert.equal((await handleSocialWebhook(request(e, { ts: NOW - 299 }), w.d)).status, 200);
});

test("webhook: with no secret on the server every call is turned away", async () => {
  const w = hookWorld({ secret: "" });
  const out = await handleSocialWebhook(request(event("channel.connected")), w.d);
  assert.equal(out.status, 500);
  assert.equal(w.rows.size, 0);
  assert.match(w.logs[0], /CAPYBAROAR_WEBHOOK_SECRET/);
});

test("webhook: channel.connected saves the channel, and channel.lost marks it lost", async () => {
  const w = hookWorld();
  const a = await handleSocialWebhook(request(event("channel.connected"), { id: "msg_a" }), w.d);
  assert.deepEqual([a.status, a.body], [200, { received: true, changed: true }]);
  assert.deepEqual(w.rows.get(`${WS}:ch_1`), { workspace_id: WS, channel_id: "ch_1", network: "instagram", name: "@anasbakery", status: "connected", updated_at: "2027-01-15T08:00:00.000Z" });
  const b = await handleSocialWebhook(request(event("channel.lost", { timestamp: "2027-01-16T08:00:00.000Z" }), { id: "msg_b" }), w.d);
  assert.equal(b.status, 200);
  assert.equal(w.rows.get(`${WS}:ch_1`)!.status, "lost");
});

test("webhook: the same webhook-id twice is handled once", async () => {
  const w = hookWorld();
  const saves: string[] = [];
  const save = w.d.save;
  w.d.save = async (row) => (saves.push(row.channel_id), save(row));
  const r = request(event("channel.connected"), { id: "msg_dup" });
  assert.deepEqual((await handleSocialWebhook(r, w.d)).body, { received: true, changed: true });
  const again = await handleSocialWebhook(r, w.d);
  assert.deepEqual([again.status, again.body], [200, { received: true, duplicate: true }]);
  assert.deepEqual(saves, ["ch_1"]);
});

test("webhook: a brand that belongs to another workspace, or an unknown workspace, is refused", async () => {
  const w = hookWorld();
  for (const e of [
    event("channel.connected", { brand_id: "cb-brand-2" }), // another workspace's brand, claiming to be ours
    event("channel.connected", { brand_id: "cb-brand-1", external_id: OTHER_WS }), // our brand, sent to another workspace
    event("channel.connected", { external_id: "7b1f3c9e-0000-4000-8000-00000000ffff" }), // no such workspace
    event("channel.connected", { external_id: "not-a-uuid" }),
  ]) {
    const out = await handleSocialWebhook(request(e, { id: `msg_${Math.random()}` }), w.d);
    assert.equal(out.status, 403, JSON.stringify(e.data));
    assert.deepEqual(out.body, { error: "This brand does not belong to that workspace." });
  }
  assert.equal(w.rows.size, 0);
  assert.equal(w.seen.size, 0, "a refused delivery is not marked");
  assert.equal(w.logs.length, 4);
});

test("webhook: a late retry never undoes a newer event", async () => {
  const w = hookWorld();
  await handleSocialWebhook(request(event("channel.lost", { timestamp: "2027-01-16T08:00:00.000Z" }), { id: "msg_new" }), w.d);
  const late = await handleSocialWebhook(request(event("channel.connected", { timestamp: "2027-01-15T08:00:00.000Z" }), { id: "msg_old" }), w.d);
  assert.deepEqual(late.body, { received: true, changed: false });
  assert.equal(w.rows.get(`${WS}:ch_1`)!.status, "lost");
});

test("webhook: a failed save takes the mark off so Capybaroar's retry runs", async () => {
  const w = hookWorld({ saveFails: true });
  const r = request(event("channel.connected"), { id: "msg_retry" });
  const first = await handleSocialWebhook(r, w.d);
  assert.equal(first.status, 500);
  assert.equal(w.seen.size, 0);
  const second = await handleSocialWebhook(r, w.d);
  assert.deepEqual([second.status, second.body], [200, { received: true, changed: true }]);
});

test("webhook: other event types are skipped, and bad bodies get 400", async () => {
  const w = hookWorld();
  const other = await handleSocialWebhook(request({ type: "post.published", data: {} }), w.d);
  assert.deepEqual([other.status, other.body], [200, { received: true, skipped: "post.published" }]);
  for (const body of ["not json", "[]", JSON.stringify(event("channel.connected", { channel: { id: "ch_1" } })), JSON.stringify(event("channel.connected", { channel: { id: "ch_1", network: "Insta Gram!" } }))]) {
    const out = await handleSocialWebhook(request(body, { id: `msg_${body.length}` }), w.d);
    assert.equal(out.status, 400, body);
  }
  assert.equal(w.rows.size, 0);
});

test("readChannelEvent: takes the flat shape too, trims long names and falls back to the sent time", () => {
  const flat = readChannelEvent(JSON.stringify({ type: "channel.lost", brand_id: "b", external_id: WS, channel: { id: "c", network: "LinkedIn", name: "x".repeat(300) } }), NOW);
  assert.ok(flat.ok);
  assert.equal(flat.event.channel.network, "linkedin");
  assert.equal(flat.event.channel.name.length, 200);
  assert.equal(flat.event.at, new Date(NOW * 1000).toISOString());
});

// ─────────────── names on screen ───────────────

test("networkName and sortChannels", () => {
  assert.equal(networkName("linkedin"), "LinkedIn");
  assert.equal(networkName("tiktok"), "TikTok");
  assert.equal(networkName("google_business"), "Google Business Profile");
  assert.equal(networkName("new_network"), "New Network");
  assert.equal(networkName(""), "Social account");
  const sorted = sortChannels([
    { network: "linkedin", name: "B", status: "connected" as const },
    { network: "facebook", name: "A", status: "connected" as const },
    { network: "x", name: "C", status: "lost" as const },
  ]);
  assert.deepEqual(sorted.map((s) => s.name), ["C", "A", "B"]);
});
