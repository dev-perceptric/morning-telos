import assert from "node:assert/strict";
import test from "node:test";
import { checkConfig, REQUIRED_KEYS } from "../src/lib/config.ts";

test("lists every required key when none are set", () => {
  assert.deepEqual(checkConfig({}).missing, [...REQUIRED_KEYS]);
});

test("passes with a good URL and publishable key", () => {
  const r = checkConfig({ SUPABASE_URL: "https://db.morningtelos.com", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_abc" });
  assert.deepEqual(r, { missing: [], problems: [] });
});

test("treats blank values as missing", () => {
  assert.deepEqual(checkConfig({ SUPABASE_URL: "  ", SUPABASE_PUBLISHABLE_KEY: "" }).missing, [...REQUIRED_KEYS]);
});

test("flags a secret key pasted in place of the publishable key", () => {
  const r = checkConfig({ SUPABASE_URL: "https://db.morningtelos.com", SUPABASE_PUBLISHABLE_KEY: "sb_secret_abc" });
  assert.equal(r.problems.length, 1);
});

test("flags a URL without https", () => {
  const r = checkConfig({ SUPABASE_URL: "http://db.morningtelos.com", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_abc" });
  assert.equal(r.problems.length, 1);
});
