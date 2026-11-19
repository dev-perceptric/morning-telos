// The Chrome extension (../extension) keeps its own copies of a few app rules, because it is built apart from the
// app. These tests fail when the two drift: the block list, the size caps, the team and the connect messages.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { CONNECTED, EXTENSION_MARK, handoverMessage, HANDOVER, isConnected } from "../src/lib/extensionConnect.ts";
import { BLOCKED_HOSTS, PAGE_TEXT_MAX, SELECTION_MAX, SHOT_MAX, TITLE_MAX } from "../src/lib/pageContext.ts";
import { AGENTS, ORDER } from "../src/lib/team.ts";

const ext = (p: string) => new URL(`../../extension/${p}`, import.meta.url);
const guard = await import(ext("src/guard.js").href);
const config = await import(ext("src/config.js").href);
const team = await import(ext("src/team.js").href);

test("the extension's block list is the server's", () => {
  assert.deepEqual(guard.BLOCKED_HOSTS, [...BLOCKED_HOSTS]);
});

test("the extension cuts pages to the server's limits", () => {
  assert.deepEqual(config.LIMITS, { text: PAGE_TEXT_MAX, selection: SELECTION_MAX, title: TITLE_MAX });
  assert.equal(config.SHOT_MAX, SHOT_MAX);
});

test("the extension's team is the app's team, in the same order", () => {
  assert.deepEqual(
    team.AGENTS,
    ORDER.map((k) => ({ key: k, god: AGENTS[k].god, name: AGENTS[k].name })),
  );
});

test("Settings and the extension's content script use the same connect messages", () => {
  const script = readFileSync(ext("src/content-app.js"), "utf8");
  assert.ok(script.includes(`dataset.${EXTENSION_MARK} = "1"`));
  assert.ok(script.includes(`"${HANDOVER}"`));
  assert.ok(script.includes(`"${CONNECTED}"`));
});

test("handoverMessage passes on a whole connect answer only", () => {
  const out = { session: { access_token: "a.b.c", refresh_token: "r", expires_at: 1 }, supabaseUrl: "https://db.test", publishableKey: "sb_publishable_x", app: "https://app.test" };
  assert.deepEqual(handoverMessage(out), { type: HANDOVER, ...out });
  assert.equal(handoverMessage({ ...out, session: { access_token: "a", refresh_token: "r" } as never }), null);
  assert.equal(handoverMessage({ ...out, publishableKey: undefined }), null);
  assert.equal(handoverMessage(null), null);
  assert.equal(isConnected({ type: CONNECTED, ok: true }), true);
  assert.equal(isConnected({ type: CONNECTED, ok: false }), false);
  assert.equal(isConnected("x"), false);
});
