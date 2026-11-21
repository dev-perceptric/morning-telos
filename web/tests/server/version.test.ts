// GET /api/version answers the commit the image was built from, and is never cached.
// Run with: node --conditions=react-server --test tests/server/*.test.ts (part of npm test).

import assert from "node:assert/strict";
import { register } from "node:module";
import { test } from "node:test";

register("./tsResolve.mjs", import.meta.url);

test("version answers the built commit, uncached", async () => {
  const { GET } = await import("../../src/app/api/version/route.ts");
  process.env.GIT_COMMIT = "abc123";
  const res = GET();
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.deepEqual(await res.json(), { commit: "abc123" });
  delete process.env.GIT_COMMIT;
  assert.deepEqual(await GET().json(), { commit: null });
});
