// PostHog: off without a key or with Do Not Track, grouped by workspace, clean URLs, and the /ingest proxy
// (src/lib/analytics.ts, next.config.ts). No PostHog is loaded or called here.
import assert from "node:assert/strict";
import test from "node:test";
import nextConfig from "../next.config.ts";
import { analyticsOn, cleanUrl, isRecent, posthogConfig, scrubEvent, track, workspaceGroup } from "../src/lib/analytics.ts";

test("off when no key was set at build time", () => {
  assert.equal(analyticsOn(undefined), false);
  assert.equal(analyticsOn(""), false);
  assert.equal(analyticsOn("   "), false);
  assert.equal(analyticsOn("phc_test"), true);
});

test("off when the browser asks not to be tracked", () => {
  assert.equal(analyticsOn("phc_test", { doNotTrack: "1" }), false);
  assert.equal(analyticsOn("phc_test", { doNotTrack: "yes" }), false);
  assert.equal(analyticsOn("phc_test", { windowDoNotTrack: "1" }), false);
  assert.equal(analyticsOn("phc_test", { globalPrivacyControl: true }), false);
  assert.equal(analyticsOn("phc_test", { doNotTrack: "0", globalPrivacyControl: false }), true);
});

test("events are grouped by the workspace on screen", () => {
  assert.deepEqual(workspaceGroup("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"), { type: "workspace", key: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
  assert.equal(workspaceGroup(""), null);
  assert.equal(workspaceGroup(null), null);
});

test("calls do nothing while PostHog is off", () => {
  assert.doesNotThrow(() => track("signed_up"));
});

test("URLs lose their query, hash and invite tokens", () => {
  assert.equal(cleanUrl("https://chat.morningtelos.com/invite/abc123def?x=1#y"), "https://chat.morningtelos.com/invite/:token");
  assert.equal(cleanUrl("https://chat.morningtelos.com/?code=secret"), "https://chat.morningtelos.com/");
  assert.equal(cleanUrl("https://chat.morningtelos.com/chat/1b2c#access_token=t"), "https://chat.morningtelos.com/chat/1b2c");
  assert.equal(cleanUrl("/invite/abc"), "/invite/:token");
  assert.equal(cleanUrl("$direct"), "$direct");
  assert.equal(cleanUrl(undefined), undefined);
  const ev = scrubEvent({
    uuid: "u",
    event: "$pageview",
    properties: { $current_url: "https://a.test/invite/tok?code=1", $pathname: "/invite/tok", plan: "trial" },
    $set: { $initial_current_url: "https://a.test/?code=1" },
  })!;
  assert.deepEqual(ev.properties, { $current_url: "https://a.test/invite/:token", $pathname: "/invite/:token", plan: "trial" });
  assert.deepEqual(ev.$set, { $initial_current_url: "https://a.test/" });
  assert.equal(scrubEvent(null), null);
});

test("PostHog goes through /ingest with replays, autocapture and surveys off", () => {
  const c = posthogConfig();
  assert.equal(c.api_host, "/ingest");
  assert.equal(c.person_profiles, "identified_only");
  assert.equal(c.disable_session_recording, true);
  assert.equal(c.autocapture, false);
  assert.equal(c.disable_surveys, true);
  assert.equal(c.respect_dnt, true);
  assert.equal(c.capture_pageview, false);
  assert.equal(c.before_send, scrubEvent);
});

test("isRecent: within a day, and never in the future", () => {
  const now = Date.parse("2026-11-18T12:00:00Z");
  assert.equal(isRecent("2026-11-18T11:00:00Z", now), true);
  assert.equal(isRecent("2026-11-17T11:59:00Z", now), false);
  assert.equal(isRecent("2026-11-19T12:00:00Z", now), false);
  assert.equal(isRecent(null, now), false);
});

test("next.config.ts proxies /ingest to PostHog US and keeps PostHog's trailing slashes", async () => {
  assert.equal(nextConfig.skipTrailingSlashRedirect, true);
  const rewrites = await nextConfig.rewrites!();
  assert.ok(Array.isArray(rewrites));
  const list = rewrites as { source: string; destination: string }[];
  assert.deepEqual(list.find((r) => r.source === "/ingest/static/:path*")?.destination, "https://us-assets.i.posthog.com/static/:path*");
  assert.deepEqual(list.find((r) => r.source === "/ingest/:path*")?.destination, "https://us.i.posthog.com/:path*");
  // The more specific asset paths come before the catch-all.
  assert.ok(list.findIndex((r) => r.source === "/ingest/static/:path*") < list.findIndex((r) => r.source === "/ingest/:path*"));
});

test("the Content-Security-Policy never blocks the same-origin /ingest calls", async () => {
  const headers = (await nextConfig.headers!()).flatMap((h) => h.headers);
  const csp = headers.filter((h) => h.key.toLowerCase() === "content-security-policy").map((h) => h.value);
  assert.ok(csp.length > 0);
  for (const v of csp) {
    for (const d of ["connect-src", "script-src", "default-src"]) {
      const m = v.match(new RegExp(`${d}([^;]*)`));
      if (m) assert.match(m[1], /'self'/, `${d} must allow 'self' for /ingest`);
    }
  }
});
