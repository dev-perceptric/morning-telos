// The one-click unsubscribe link: sealed tokens and the route's logic (src/lib/unsubscribe.ts).
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { keyringFromEnv, sealWith } from "../src/lib/sealing.ts";
import { handleUnsubscribe, readUnsubscribeToken, unsubscribeHeaders, unsubscribeToken, unsubscribeUrl, type Unsubscriber } from "../src/lib/unsubscribe.ts";

const ring = keyringFromEnv({ SEALING_KEYS: `a:${randomBytes(32).toString("base64")}` });
const other = keyringFromEnv({ SEALING_KEYS: `a:${randomBytes(32).toString("base64")}` });
const who: Unsubscriber = { workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", userId: "11111111-1111-4111-8111-111111111111" };

test("a token opens to the same person and workspace, and only with our key", () => {
  const t = unsubscribeToken(ring, who);
  assert.deepEqual(readUnsubscribeToken(ring, t), who);
  assert.equal(readUnsubscribeToken(other, t), null);
  assert.equal(readUnsubscribeToken(ring, t.slice(0, -4) + "AAAA"), null);
  assert.equal(readUnsubscribeToken(ring, ""), null);
  assert.equal(readUnsubscribeToken(ring, null), null);
  assert.equal(readUnsubscribeToken(ring, "x".repeat(2000)), null);
  // A value sealed for something else (a brand key) never works as a token.
  assert.equal(readUnsubscribeToken(ring, sealWith(ring, JSON.stringify({ w: who.workspaceId, u: who.userId }))), null);
  // Not ids.
  assert.equal(readUnsubscribeToken(ring, sealWith(ring, JSON.stringify({ w: "x", u: "y" }), "email-unsubscribe")), null);
});

test("the link survives being put in a URL", () => {
  const t = unsubscribeToken(ring, who);
  const url = unsubscribeUrl("https://chat.example.test/", t);
  assert.ok(url.startsWith("https://chat.example.test/api/email/unsubscribe?t="));
  assert.deepEqual(readUnsubscribeToken(ring, new URL(url).searchParams.get("t")), who);
  assert.deepEqual(unsubscribeHeaders(url), { "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
});

function deps(fail = false) {
  const saved: Unsubscriber[] = [];
  return {
    saved,
    d: {
      ring,
      appUrl: "https://chat.example.test",
      save: async (u: Unsubscriber) => {
        if (fail) throw new Error("db down");
        saved.push(u);
      },
    },
  };
}

test("opening the link shows one button and changes nothing", async () => {
  const { d, saved } = deps();
  const t = unsubscribeToken(ring, who);
  const out = await handleUnsubscribe({ method: "GET", token: t }, d);
  assert.equal(out.status, 200);
  assert.match(out.html, /<form method="post"/);
  assert.match(out.html, /Turn them off/);
  assert.ok(out.html.includes(`action="?t=${encodeURIComponent(t)}"`));
  assert.equal(saved.length, 0);
});

test("POST turns the digest off for that person and workspace", async () => {
  const { d, saved } = deps();
  const out = await handleUnsubscribe({ method: "POST", token: unsubscribeToken(ring, who) }, d);
  assert.equal(out.status, 200);
  assert.match(out.html, /You&#39;re unsubscribed/);
  assert.deepEqual(saved, [who]);
});

test("a bad link or a missing key saves nothing, and a failed save says so", async () => {
  const { d, saved } = deps();
  assert.equal((await handleUnsubscribe({ method: "POST", token: "v2.a.bad" }, d)).status, 400);
  assert.equal((await handleUnsubscribe({ method: "POST", token: unsubscribeToken(ring, who) }, { ...d, ring: null })).status, 400);
  assert.equal(saved.length, 0);
  const failing = deps(true);
  const out = await handleUnsubscribe({ method: "POST", token: unsubscribeToken(ring, who) }, failing.d);
  assert.equal(out.status, 500);
  assert.match(out.html, /couldn&#39;t save/);
});

test("the pages use plain words with no dashes", async () => {
  const { d } = deps();
  const t = unsubscribeToken(ring, who);
  for (const req of [{ method: "GET", token: t }, { method: "POST", token: t }, { method: "GET", token: null }]) {
    assert.doesNotMatch((await handleUnsubscribe(req, d)).html, /[—–]/);
  }
});
