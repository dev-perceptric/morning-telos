// The minute-long memory of checked sign-in tokens (src/lib/userCache.ts), with a fake clock and a fake check.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CACHE_MS, tokenExpiry, userCache } from "../src/lib/userCache.ts";

const jwt = (exp?: number) => `h.${Buffer.from(JSON.stringify(exp === undefined ? { sub: "u1" } : { sub: "u1", exp })).toString("base64url")}.sig`;
const T0 = 1_800_000_000_000;

test("tokenExpiry reads exp in milliseconds, or null", () => {
  assert.equal(tokenExpiry(jwt(1_800_000_100)), 1_800_000_100_000);
  assert.equal(tokenExpiry(jwt()), null);
  assert.equal(tokenExpiry("not-a-token"), null);
  assert.equal(tokenExpiry("a.%%%.b"), null);
});

test("a checked token is remembered for a minute at most, then checked again", async () => {
  let now = T0;
  let checks = 0;
  const cache = userCache<{ id: string }>({ now: () => now });
  const check = async () => (checks++, { id: "u1" });
  const token = jwt(T0 / 1000 + 3600);
  assert.deepEqual(await cache.get(token, check), { id: "u1" });
  assert.deepEqual(await cache.get(token, check), { id: "u1" });
  assert.equal(checks, 1);
  now += CACHE_MS + 1;
  await cache.get(token, check);
  assert.equal(checks, 2);
});

test("never past the token's own expiry, and a refused token is never remembered", async () => {
  let now = T0;
  let checks = 0;
  const cache = userCache<{ id: string }>({ now: () => now });
  const soon = jwt(T0 / 1000 + 5);
  await cache.get(soon, async () => (checks++, { id: "u1" }));
  now += 6000;
  await cache.get(soon, async () => (checks++, null));
  assert.equal(checks, 2);
  assert.equal(await cache.get(soon, async () => (checks++, null)), null);
  assert.equal(checks, 3, "null was not kept");
  const expired = jwt(T0 / 1000 - 10);
  await cache.get(expired, async () => ({ id: "u1" }));
  assert.equal(cache.size(), 0, "an expired token is not kept");
});

test("different tokens never share an answer, and the memory stays small", async () => {
  const cache = userCache<{ id: string }>({ now: () => T0, max: 3 });
  const a = await cache.get(jwt(T0 / 1000 + 3600) + "a", async () => ({ id: "a" }));
  const b = await cache.get(jwt(T0 / 1000 + 3600) + "b", async () => ({ id: "b" }));
  assert.notDeepEqual(a, b);
  for (let i = 0; i < 10; i++) await cache.get(`${jwt(T0 / 1000 + 3600)}${i}`, async () => ({ id: String(i) }));
  assert.ok(cache.size() <= 3);
});
