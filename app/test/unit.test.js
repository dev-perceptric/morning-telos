// Fast checks on pure functions. No database or network needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AGENTS, ORDER, MODELS, SERVICES, costOf, isWrite, parseMentions } from "../lib/agents.js";
import { hashPassword, checkPassword } from "../lib/util.js";

test("every agent in ORDER exists and has the fields the app needs", () => {
  assert.equal(new Set(ORDER).size, ORDER.length, "ORDER has duplicates");
  for (const k of ORDER) {
    const a = AGENTS[k];
    assert.ok(a, `AGENTS.${k} is missing`);
    for (const f of ["god", "name", "job"]) assert.ok(a[f], `AGENTS.${k}.${f} is empty`);
    assert.ok(Array.isArray(a.apps), `AGENTS.${k}.apps must be an array`);
    assert.ok(Array.isArray(a.out) && a.out.length, `AGENTS.${k}.out must list what they deliver`);
    for (const app of a.apps) assert.ok(app === "*" || SERVICES[app], `AGENTS.${k} uses unknown app "${app}"`);
  }
  for (const k of Object.keys(AGENTS)) assert.ok(ORDER.includes(k), `AGENTS.${k} is not in ORDER`);
});

test("agent names are unique so @mentions are not ambiguous", () => {
  const gods = ORDER.map((k) => AGENTS[k].god.toLowerCase());
  assert.equal(new Set(gods).size, gods.length);
});

test("parseMentions finds teammates by name, once each, in order", () => {
  const [first, second] = ORDER.filter((k) => !AGENTS[k].soon);
  const g1 = AGENTS[first].god, g2 = AGENTS[second].god;
  assert.deepEqual(parseMentions(`@${g2} and @${g1.toLowerCase()} and @${g2} again`), [second, first]);
  assert.deepEqual(parseMentions("@nobody here"), []);
  assert.deepEqual(parseMentions("no mentions"), []);
});

test("isWrite trusts annotations first, then the tool name", () => {
  assert.equal(isWrite({ name: "create_posts" }), true);
  assert.equal(isWrite({ name: "delete_post" }), true);
  assert.equal(isWrite({ name: "list_posts" }), false);
  assert.equal(isWrite({ name: "get_analytics" }), false);
  assert.equal(isWrite({ name: "create_report", annotations: { readOnlyHint: true } }), false);
  assert.equal(isWrite({ name: "list_things", annotations: { destructiveHint: true } }), true);
});

test("costOf prices every model and falls back for unknown ones", () => {
  const u = { input_tokens: 1e6, output_tokens: 0, cache_read: 0, cache_write: 0 };
  for (const id of new Set(Object.values(MODELS))) assert.ok(costOf({ ...u, model: id }) > 0, `no price for ${id}`);
  assert.equal(costOf({ ...u, model: "unknown" }), costOf({ ...u, model: MODELS.opus }));
});

test("passwords hash and check", () => {
  const h = hashPassword("correct horse battery");
  assert.equal(checkPassword("correct horse battery", h), true);
  assert.equal(checkPassword("wrong password!!", h), false);
  assert.equal(checkPassword("x", "garbage"), false);
});
