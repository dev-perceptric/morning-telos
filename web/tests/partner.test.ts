// The partner API client (src/lib/partner.ts) against a fake fetch. Nothing reaches Arrowsterr or Capybaroar.
import assert from "node:assert/strict";
import test from "node:test";
import { channelGone, integrationConnectFor, isRetryable, partnerClient, partnerFor, socialConnectClient, socialConnectFor } from "../src/lib/partner.ts";

type Call = { url: string; method: string; headers: Headers; body: unknown };

function fakeFetch(answer: (c: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const c = { url: String(input), method: init?.method ?? "GET", headers: new Headers(init?.headers), body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(c);
    return answer(c);
  }) as typeof fetch;
  return { f, calls };
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const ENV = { ARROWSTERR_PARTNER_URL: "https://aw.test/", ARROWSTERR_PARTNER_KEY: "aw_partner_x", CAPYBAROAR_PARTNER_URL: "https://cb.test", CAPYBAROAR_PARTNER_KEY: "cb_partner_y" };

test("partnerFor: a missing key or address is a plain-English error", () => {
  const { f } = fakeFetch(() => json(200, {}));
  assert.deepEqual(partnerFor("arrowsterr", { ...ENV, ARROWSTERR_PARTNER_KEY: "" }, f), { ok: false, error: "Arrowsterr partner key is not set on the server." });
  assert.deepEqual(partnerFor("capybaroar", { ...ENV, CAPYBAROAR_PARTNER_KEY: " " }, f), { ok: false, error: "Capybaroar partner key is not set on the server." });
  assert.deepEqual(partnerFor("arrowsterr", { ...ENV, ARROWSTERR_PARTNER_URL: undefined }, f), { ok: false, error: "Arrowsterr partner address is not set on the server." });
  assert.deepEqual(partnerFor("capybaroar", { ...ENV, CAPYBAROAR_PARTNER_URL: "cb.test" }, f), { ok: false, error: "Capybaroar partner address is not set on the server." });
  assert.equal(partnerFor("arrowsterr", ENV, f).ok, true);
});

test("each product uses its own address and key", async () => {
  const { f, calls } = fakeFetch(() => json(201, { id: "b1", name: "A", domain: null, external_id: "ws1" }));
  for (const p of ["arrowsterr", "capybaroar"] as const) {
    const r = partnerFor(p, ENV, f);
    assert.ok(r.ok);
    await r.partner.createBrand({ name: "A", domain: null, external_id: "ws1" });
  }
  assert.equal(calls[0].url, "https://aw.test/api/partner/brands");
  assert.equal(calls[0].headers.get("authorization"), "Bearer aw_partner_x");
  assert.equal(calls[1].url, "https://cb.test/api/partner/brands");
  assert.equal(calls[1].headers.get("authorization"), "Bearer cb_partner_y");
});

test("createBrand, createKey and revokeKeys follow the contract", async () => {
  const { f, calls } = fakeFetch((c) => {
    if (c.method === "POST" && c.url.endsWith("/brands")) return json(201, { id: "b 1", ...(c.body as object) });
    if (c.method === "POST" && c.url.endsWith("/keys")) return json(201, { key: "aw_brand_secret", prefix: "aw_brand_sec" });
    if (c.method === "DELETE") return new Response(null, { status: 204 });
    return json(404, { error: { code: "not_found", message: "No." } });
  });
  const api = partnerClient({ product: "arrowsterr", url: "https://aw.test", key: "k", fetch: f });
  const brand = await api.createBrand({ name: "Ana's Bakery", domain: "anasbakery.com", external_id: "ws1" });
  assert.deepEqual(brand, { ok: true, status: 201, data: { id: "b 1", name: "Ana's Bakery", domain: "anasbakery.com", external_id: "ws1" } });
  assert.equal(calls[0].headers.get("content-type"), "application/json");
  assert.deepEqual(await api.createKey("b 1"), { ok: true, status: 201, data: { key: "aw_brand_secret", prefix: "aw_brand_sec" } });
  assert.equal(calls[1].url, "https://aw.test/api/partner/brands/b%201/keys");
  assert.deepEqual(await api.revokeKeys("b 1"), { ok: true, status: 204, data: null });
  assert.equal(calls[2].method, "DELETE");
  assert.equal(calls[2].url, "https://aw.test/api/partner/brands/b%201/keys");
});

test("the same external_id again answers 200 with the brand already made", async () => {
  const { f } = fakeFetch(() => json(200, { id: "b1", name: "A", domain: null, external_id: "ws1" }));
  const r = await partnerClient({ product: "capybaroar", url: "https://cb.test", key: "k", fetch: f }).createBrand({ name: "A", domain: null, external_id: "ws1" });
  assert.ok(r.ok);
  assert.equal(r.status, 200);
  assert.equal(r.data.id, "b1");
});

test("errors come back typed: 5xx and 429 are retryable, 401/403/404/409/422 are not", async () => {
  for (const [status, retryable] of [[500, true], [502, true], [503, true], [429, true], [401, false], [403, false], [404, false], [409, false], [422, false]] as const) {
    const { f } = fakeFetch(() => json(status, { error: { code: `c${status}`, message: `m${status}` } }));
    const r = await partnerClient({ product: "arrowsterr", url: "https://aw.test", key: "k", fetch: f }).createKey("b1");
    assert.deepEqual(r, { ok: false, status, code: `c${status}`, message: `m${status}`, retryable }, String(status));
  }
  // A body that isn't the error shape still gives a typed error.
  const { f } = fakeFetch(() => new Response("<html>Bad gateway</html>", { status: 502, statusText: "Bad Gateway" }));
  const r = await partnerClient({ product: "arrowsterr", url: "https://aw.test", key: "k", fetch: f }).createKey("b1");
  assert.deepEqual(r, { ok: false, status: 502, code: "http_502", message: "Bad Gateway", retryable: true });
});

test("a timeout or a network error is retryable, and nothing throws", async () => {
  // Never answers. The timer only keeps the test process waiting, since AbortSignal.timeout doesn't.
  const slow = (async (_u: unknown, init?: RequestInit) =>
    new Promise<Response>((_ok, bad) => {
      const hold = setTimeout(() => {}, 5_000);
      init?.signal?.addEventListener("abort", () => {
        clearTimeout(hold);
        bad(init.signal!.reason);
      });
    })) as typeof fetch;
  const t = await partnerClient({ product: "arrowsterr", url: "https://aw.test", key: "k", fetch: slow, timeoutMs: 20 }).createBrand({ name: "A", domain: null, external_id: "ws1" });
  assert.deepEqual(t, { ok: false, status: 0, code: "timeout", message: "No answer in time.", retryable: true });

  const down = (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch;
  const n = await partnerClient({ product: "capybaroar", url: "https://cb.test", key: "k", fetch: down }).createKey("b1");
  assert.deepEqual(n, { ok: false, status: 0, code: "network", message: "Could not connect.", retryable: true });
});

test("a success without the fields we need is a retryable bad answer", async () => {
  const { f } = fakeFetch((c) => (c.url.endsWith("/keys") ? json(201, { prefix: "p" }) : json(201, { name: "no id" })));
  const api = partnerClient({ product: "arrowsterr", url: "https://aw.test", key: "k", fetch: f });
  assert.equal((await api.createBrand({ name: "A", domain: null, external_id: "ws1" })).ok, false);
  const k = await api.createKey("b1");
  assert.ok(!k.ok && k.retryable && k.code === "bad_response");
  const { f: notJson } = fakeFetch(() => new Response("ok", { status: 200 }));
  const r = await partnerClient({ product: "arrowsterr", url: "https://aw.test", key: "k", fetch: notJson }).createBrand({ name: "A", domain: null, external_id: "ws1" });
  assert.ok(!r.ok && r.retryable && r.code === "bad_response");
});

test("isRetryable", () => {
  assert.deepEqual([0, 408, 429, 500, 503, 400, 401, 403, 404, 409, 422].map((s) => isRetryable(s)), [true, true, true, true, true, false, false, false, false, false, false]);
});

test("409s: Capybaroar's conflict is retryable; domain_taken, plan_limit and limit_reached are not", async () => {
  for (const [code, retryable] of [["conflict", true], ["domain_taken", false], ["plan_limit", false], ["limit_reached", false], ["too_many_keys", false]] as const) {
    const { f } = fakeFetch(() => json(409, { error: { code, message: "m" } }));
    const r = await partnerClient({ product: "capybaroar", url: "https://cb.test", key: "k", fetch: f }).createBrand({ name: "A", domain: null, external_id: "ws1" });
    assert.ok(!r.ok);
    assert.deepEqual([r.code, r.retryable], [code, retryable]);
  }
});

test("connectLink posts to the brand's connect-link and needs a web address back", async () => {
  const { f, calls } = fakeFetch(() => json(201, { url: "https://cb.test/connect/tok", expires_at: "2026-11-18T10:00:00Z" }));
  const api = partnerClient({ product: "capybaroar", url: "https://cb.test", key: "k", fetch: f });
  assert.deepEqual(await api.connectLink("b 1"), { ok: true, status: 201, data: { url: "https://cb.test/connect/tok", expires_at: "2026-11-18T10:00:00Z" } });
  assert.deepEqual([calls[0].method, calls[0].url], ["POST", "https://cb.test/api/partner/brands/b%201/connect-link"]);
  for (const body of [{}, { url: "javascript:alert(1)" }, { url: "" }]) {
    const { f: bad } = fakeFetch(() => json(201, body));
    const r = await partnerClient({ product: "capybaroar", url: "https://cb.test", key: "k", fetch: bad }).connectLink("b1");
    assert.ok(!r.ok && r.code === "bad_response", JSON.stringify(body));
  }
});

test("removeBrand deletes the brand, and a 404 comes back typed", async () => {
  const { f, calls } = fakeFetch((c) => (c.url.endsWith("/brands/b1") ? new Response(null, { status: 204 }) : json(404, { error: { code: "not_found", message: "No such brand." } })));
  const api = partnerClient({ product: "arrowsterr", url: "https://aw.test", key: "k", fetch: f });
  assert.deepEqual(await api.removeBrand("b1"), { ok: true, status: 204, data: null });
  assert.deepEqual([calls[0].method, calls[0].url], ["DELETE", "https://aw.test/api/partner/brands/b1"]);
  assert.deepEqual(await api.removeBrand("gone"), { ok: false, status: 404, code: "not_found", message: "No such brand.", retryable: false });
});

test("disconnectChannel deletes one channel from the brand; only Capybaroar's own 'channel not found' counts as gone", async () => {
  const { f, calls } = fakeFetch((c) => {
    if (c.url.endsWith("/brands/b1/channels/c%201")) return new Response(null, { status: 204 });
    if (c.url.endsWith("/brands/b1/channels/old")) return json(404, { error: { code: "not_found", message: "Channel not found" } });
    if (c.url.includes("/brands/gone/")) return json(404, { error: { code: "not_found", message: "Brand not found" } });
    return new Response("<html>404</html>", { status: 404 });
  });
  const api = partnerClient({ product: "capybaroar", url: "https://cb.test", key: "k", fetch: f });
  assert.deepEqual(await api.disconnectChannel("b1", "c 1"), { ok: true, status: 204, data: null });
  assert.deepEqual([calls[0].method, calls[0].url], ["DELETE", "https://cb.test/api/partner/brands/b1/channels/c%201"]);
  const old = await api.disconnectChannel("b1", "old");
  assert.equal(!old.ok && channelGone(old), true);
  const brand = await api.disconnectChannel("gone", "c");
  assert.equal(!brand.ok && channelGone(brand), false);
  const noRoute = await api.disconnectChannel("b1", "x");
  assert.equal(!noRoute.ok && noRoute.code, "http_404");
  assert.equal(!noRoute.ok && channelGone(noRoute), false);
});

// ─────────────── connecting on our own page ───────────────

test("socialConnectClient: the networks list, the start, and the pick step, under <url>/api/partner", async () => {
  const { f, calls } = fakeFetch((c) => {
    if (c.url.endsWith("/networks")) return json(200, { networks: [{ id: "linkedin", name: "LinkedIn", kind: "profile" }, { id: "Facebook", name: "Facebook" }, { id: "bad id", name: "x" }, { id: "x" }, { id: "linkedin", name: "Again" }] });
    if (c.url.endsWith("/connect/start")) return json(200, { url: "https://www.linkedin.com/oauth/v2/authorization?x=1" });
    if (c.method === "GET") return json(200, { network: "linkedin-page", options: [{ id: "p1", name: "Ana's Bakery", picture: "https://cdn.test/a.png" }, { id: "p2", name: "Shop", picture: "javascript:alert(1)" }, { id: "p1", name: "dup" }, { name: "no id" }] });
    return json(200, { channels: [{ id: "ch1" }] });
  });
  const r = socialConnectFor({ CAPYBAROAR_PARTNER_URL: "https://cb.test/", CAPYBAROAR_PARTNER_KEY: "cb_partner_y" }, f);
  assert.ok(r.ok);
  assert.deepEqual(await r.client.networks(), { ok: true, status: 200, data: [{ id: "linkedin", name: "LinkedIn", kind: "profile" }, { id: "facebook", name: "Facebook", kind: "" }] });
  assert.deepEqual(await r.client.start("b 1", { network: "linkedin", return_url: "https://app.test/settings/social/return?state=s" }), { ok: true, status: 200, data: { url: "https://www.linkedin.com/oauth/v2/authorization?x=1" } });
  assert.deepEqual(await r.client.pick("tok_12345678"), {
    ok: true,
    status: 200,
    data: { network: "linkedin-page", options: [{ id: "p1", name: "Ana's Bakery", picture: "https://cdn.test/a.png" }, { id: "p2", name: "Shop", picture: null }] },
  });
  assert.deepEqual(await r.client.pickConnect("tok_12345678", ["p1"]), { ok: true, status: 200, data: { channels: [{ id: "ch1" }] } });
  assert.deepEqual(
    calls.map((c) => [c.method, c.url, c.body]),
    [
      ["GET", "https://cb.test/api/partner/networks", undefined],
      ["POST", "https://cb.test/api/partner/brands/b%201/connect/start", { network: "linkedin", return_url: "https://app.test/settings/social/return?state=s" }],
      ["GET", "https://cb.test/api/partner/connect/pick/tok_12345678", undefined],
      ["POST", "https://cb.test/api/partner/connect/pick/tok_12345678", { ids: ["p1"] }],
    ],
  );
  assert.equal(calls[0].headers.get("authorization"), "Bearer cb_partner_y");
  assert.equal(socialConnectFor({}, f).ok, false);
});

test("socialConnectClient: a 404 stays a 404 (the older partner), and a broken answer is a retryable bad_response", async () => {
  const missing = fakeFetch(() => json(404, { error: { code: "not_found", message: "No." } }));
  const c = socialConnectClient({ product: "capybaroar", url: "https://cb.test", key: "k", fetch: missing.f });
  const r = await c.networks();
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.status, 404);
  const broken = fakeFetch((x) => (x.url.endsWith("/networks") ? json(200, { networks: "no" }) : x.method === "GET" ? json(200, { network: "x" }) : json(200, { url: "http://plain.test/x" })));
  const b = socialConnectClient({ product: "capybaroar", url: "https://cb.test", key: "k", fetch: broken.f });
  for (const out of [await b.networks(), await b.start("b", { network: "x", return_url: "https://a.test" }), await b.pick("tok_12345678")]) {
    assert.equal(out.ok, false);
    assert.equal(!out.ok && out.code, "bad_response");
    assert.equal(!out.ok && out.retryable, true);
  }
});

test("integrationConnectClient: Arrowsterr's integrations and its start", async () => {
  const { f, calls } = fakeFetch((c) => (c.url.endsWith("/integrations") ? json(200, { integrations: [{ id: "google_search_console", name: "Google Search Console", kind: "seo" }] }) : json(201, { url: "https://accounts.google.test/o/oauth2?x" })));
  const r = integrationConnectFor(ENV, f);
  assert.ok(r.ok);
  assert.deepEqual(await r.client.integrations(), { ok: true, status: 200, data: [{ id: "google_search_console", name: "Google Search Console", kind: "seo" }] });
  assert.deepEqual(await r.client.start("aw-1", { integration: "google_search_console", return_url: "https://app.test/r" }), { ok: true, status: 201, data: { url: "https://accounts.google.test/o/oauth2?x" } });
  assert.deepEqual(calls.map((c) => [c.method, c.url, c.body]), [
    ["GET", "https://aw.test/api/partner/integrations", undefined],
    ["POST", "https://aw.test/api/partner/brands/aw-1/connect/start", { integration: "google_search_console", return_url: "https://app.test/r" }],
  ]);
  assert.equal(calls[0].headers.get("authorization"), "Bearer aw_partner_x");
});
