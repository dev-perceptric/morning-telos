import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { keyringFromEnv, openWith, resealWith, sealedKid, sealWith } from "../src/lib/sealing.ts";

const k = () => randomBytes(32).toString("base64");
const A = k(), B = k();

test("seal and open round trip, bound to its row", () => {
  const ring = keyringFromEnv({ SEALING_KEYS: `a:${A}` });
  const s = sealWith(ring, "aw_brand_secret", "ws1:arrowsterr");
  assert.ok(s.startsWith("v2.a."));
  assert.ok(!s.includes("aw_brand_secret"));
  assert.equal(openWith(ring, s, "ws1:arrowsterr"), "aw_brand_secret");
});

test("a value moved to another row won't open", () => {
  const ring = keyringFromEnv({ SEALING_KEYS: `a:${A}` });
  const s = sealWith(ring, "secret", "ws1:arrowsterr");
  assert.throws(() => openWith(ring, s, "ws2:arrowsterr"));
});

test("a changed value won't open", () => {
  const ring = keyringFromEnv({ SEALING_KEYS: `a:${A}` });
  const p = sealWith(ring, "secret", "x").split(".");
  const body = Buffer.from(p[4], "base64");
  body[0] ^= 1;
  p[4] = body.toString("base64");
  assert.throws(() => openWith(ring, p.join("."), "x"));
});

test("the wrong key won't open it, and a relabelled kid won't either", () => {
  const s = sealWith(keyringFromEnv({ SEALING_KEYS: `a:${A}` }), "secret");
  assert.throws(() => openWith(keyringFromEnv({ SEALING_KEYS: `a:${B}` }), s));
  const both = keyringFromEnv({ SEALING_KEYS: `a:${A},b:${A}` });
  assert.throws(() => openWith(both, s.replace("v2.a.", "v2.b.")));
});

test("rotation: old values still open, new ones use the current key, reseal moves them over", () => {
  const old = keyringFromEnv({ SEALING_KEYS: `a:${A}` });
  const s = sealWith(old, "secret", "row");
  const ring = keyringFromEnv({ SEALING_KEYS: `a:${A},b:${B}`, SEALING_KEY_CURRENT: "b" });
  assert.equal(openWith(ring, s, "row"), "secret");
  assert.equal(sealedKid(sealWith(ring, "x")), "b");
  const moved = resealWith(ring, s, "row");
  assert.ok(moved && sealedKid(moved) === "b");
  assert.equal(openWith(ring, moved!, "row"), "secret");
  assert.equal(resealWith(ring, moved!, "row"), null);
});

test("bad settings are refused with a clear message", () => {
  assert.throws(() => keyringFromEnv({}), /SEALING_KEYS is not set/);
  assert.throws(() => keyringFromEnv({ SEALING_KEYS: "a:short" }), /32 bytes/);
  assert.throws(() => keyringFromEnv({ SEALING_KEYS: `a:${A},a:${B}` }), /twice/);
  assert.throws(() => keyringFromEnv({ SEALING_KEYS: `a:${A}`, SEALING_KEY_CURRENT: "z" }), /not in SEALING_KEYS/);
  assert.throws(() => keyringFromEnv({ SEALING_KEYS: `bad kid:${A}` }), /kid/);
});

test("junk isn't treated as a sealed value", () => {
  assert.equal(sealedKid("aw_brand_plaintext"), null);
  assert.throws(() => openWith(keyringFromEnv({ SEALING_KEYS: `a:${A}` }), "aw_brand_plaintext"), /Unknown sealed format/);
});
