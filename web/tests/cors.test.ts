// CORS for the Chrome extension (src/lib/cors.ts): only the extension's own origin, never "*", never credentials.
import assert from "node:assert/strict";
import { test } from "node:test";
import { corsHeaders, extensionOrigins, otherExtension, preflight, refuseOtherExtension, withCors } from "../src/lib/cors.ts";

const ID = "abcdefghijklmnopabcdefghijklmnop";
const OURS = `chrome-extension://${ID}`;
const THEIRS = "chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba";
const allowed = [OURS];

test("extensionOrigins reads real extension ids only", () => {
  assert.deepEqual(extensionOrigins(` ${ID.toUpperCase()} , bad id, ${"q".repeat(32)}, `), [OURS]);
  assert.deepEqual(extensionOrigins(""), []);
  assert.deepEqual(extensionOrigins(undefined), []);
});

test("corsHeaders: the exact extension origin, no wildcard and no credentials", () => {
  const h = corsHeaders(OURS, allowed);
  assert.equal(h["Access-Control-Allow-Origin"], OURS);
  assert.equal(h["Access-Control-Allow-Headers"], "Authorization, Content-Type");
  assert.equal(h.Vary, "Origin");
  assert.ok(!("Access-Control-Allow-Credentials" in h));
  assert.ok(!Object.values(h).includes("*"));
  for (const o of [THEIRS, "https://evil.example", "https://chat.morningtelos.com", null]) assert.deepEqual(corsHeaders(o, allowed), { Vary: "Origin" }, String(o));
  assert.deepEqual(corsHeaders(OURS, []), { Vary: "Origin" }, "nothing allowed when EXTENSION_IDS is empty");
});

test("preflight answers only the extension", () => {
  const req = (origin?: string) => new Request("https://app.test/api/chat", { method: "OPTIONS", headers: origin ? { Origin: origin } : {} });
  const ok = preflight(req(OURS), allowed);
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get("access-control-allow-origin"), OURS);
  assert.equal(ok.headers.get("access-control-allow-credentials"), null);
  for (const o of [THEIRS, "https://evil.example", undefined]) {
    const r = preflight(req(o), allowed);
    assert.equal(r.status, 403);
    assert.equal(r.headers.get("access-control-allow-origin"), null);
  }
});

test("withCors adds the headers to a response only for the extension", () => {
  const r = withCors(new Request("https://app.test/x", { headers: { Origin: OURS } }), Response.json({ ok: true }), allowed);
  assert.equal(r.headers.get("access-control-allow-origin"), OURS);
  const s = withCors(new Request("https://app.test/x", { headers: { Origin: "https://evil.example" } }), Response.json({ ok: true }), allowed);
  assert.equal(s.headers.get("access-control-allow-origin"), null);
});

test("another extension is turned away; pages and the app itself are not affected", () => {
  assert.equal(otherExtension(THEIRS, allowed), true);
  assert.equal(otherExtension(OURS, allowed), false);
  assert.equal(otherExtension("https://chat.morningtelos.com", allowed), false);
  assert.equal(otherExtension(null, allowed), false);
  assert.equal(refuseOtherExtension(new Request("https://app.test/x", { headers: { Origin: THEIRS } }), allowed)?.status, 403);
  assert.equal(refuseOtherExtension(new Request("https://app.test/x", { headers: { Origin: OURS } }), allowed), null);
  assert.equal(refuseOtherExtension(new Request("https://app.test/x"), allowed), null);
});
