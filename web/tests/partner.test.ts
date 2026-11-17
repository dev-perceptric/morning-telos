// The partner API client (src/lib/partner.ts) against a fake fetch. Nothing reaches Arrowsterr or Capybaroar.
import assert from "node:assert/strict";
import test from "node:test";
import { isRetryable, partnerClient, partnerFor } from "../src/lib/partner.ts";

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
