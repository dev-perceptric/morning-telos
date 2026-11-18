import assert from "node:assert/strict";
import test from "node:test";
import { googleEnabled } from "../src/lib/authProviders.ts";

test("Google shows only when Supabase Auth says it is on", () => {
  assert.equal(googleEnabled({ external: { google: true, email: true } }), true);
  assert.equal(googleEnabled({ external: { google: false, email: true } }), false);
  assert.equal(googleEnabled({ external: { email: true } }), false);
  assert.equal(googleEnabled({}), false);
  assert.equal(googleEnabled(null), false);
  assert.equal(googleEnabled("junk"), false);
  assert.equal(googleEnabled({ external: { google: "true" } }), false);
});
