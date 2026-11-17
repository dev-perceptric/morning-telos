import assert from "node:assert/strict";
import test from "node:test";
import { sentryOptions } from "../src/lib/sentry.ts";
import { looksStale } from "../src/lib/staleBuild.ts";

test("Sentry stays off with no DSN", () => {
  assert.equal(sentryOptions(undefined), null);
  assert.equal(sentryOptions(""), null);
  assert.equal(sentryOptions("   \n"), null);
});

test("Sentry turns on with a DSN and never sends personal data", () => {
  const o = sentryOptions(" https://abc@o1.ingest.sentry.io/2 ", "production");
  assert.deepEqual(o, { dsn: "https://abc@o1.ingest.sentry.io/2", environment: "production", tracesSampleRate: 0.05, sendDefaultPii: false });
  assert.equal(sentryOptions("https://abc@o1.ingest.sentry.io/2", "")?.environment, undefined);
});

test("spots errors from a stale build", () => {
  assert.equal(looksStale(new Error("Loading chunk 123 failed")), true);
  assert.equal(looksStale(Object.assign(new Error("x"), { name: "ChunkLoadError" })), true);
  assert.equal(looksStale(new Error("l is not a function")), true);
  assert.equal(looksStale(new Error("Workspace not found")), false);
});
