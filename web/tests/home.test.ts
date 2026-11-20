import assert from "node:assert/strict";
import test from "node:test";
import { ago, finishSetup, firstName, greeting, homeIdeas, initial, paletteMatch, reachChannels, showSlackBanner, slackBannerKey, trialPill, type PaletteItem, type SetupState } from "../src/lib/home.ts";
import { effectivePlan } from "../src/lib/plans.ts";

test("greeting: by the hour, with the first name", () => {
  assert.equal(greeting(8, "Vincent Nguyen"), "Good morning, Vincent");
  assert.equal(greeting(12, "Vincent"), "Good afternoon, Vincent");
  assert.equal(greeting(19, ""), "Good evening");
  assert.equal(greeting(23, "jo@example.com"), "Good evening");
  assert.equal(firstName("  Ana  Maria "), "Ana");
  assert.equal(firstName(null), "");
  assert.equal(initial("vincent"), "V");
  assert.equal(initial(""), "?");
});

test("ago: now, minutes, hours, then a date", () => {
  const now = Date.parse("2026-11-18T12:00:00Z");
  assert.equal(ago("2026-11-18T11:59:30Z", now), "now");
  assert.equal(ago("2026-11-18T11:55:00Z", now), "5m");
  assert.equal(ago("2026-11-18T09:00:00Z", now), "3h");
  assert.equal(ago("2026-11-02T09:00:00Z", now), "Nov 2");
  assert.equal(ago("not a date", now), "");
});

test("trialPill: trial days, ended trial, nothing on paid or internal plans", () => {
  const now = Date.parse("2026-11-18T12:00:00Z");
  const trial = effectivePlan({ plan: "trial", status: "trialing", trial_ends_at: "2026-12-02T12:00:00Z" }, now);
  assert.deepEqual(trialPill(trial), { warn: false, lead: "Free trial:", strong: "14 days left", cta: "Choose a plan" });
  assert.equal(trialPill({ plan: "trial", daysLeft: 1 })?.strong, "1 day left");
  assert.equal(trialPill({ plan: "trial", daysLeft: 2 })?.warn, true);
  assert.equal(trialPill({ plan: "expired", daysLeft: 0 })?.warn, true);
  assert.equal(trialPill(effectivePlan({ plan: "pro", status: "active", trial_ends_at: null }, now)), null);
  assert.equal(trialPill(effectivePlan({ plan: "internal", status: null, trial_ends_at: null }, now)), null);
});

test("homeIdeas: SEO and social ideas wait for their product", () => {
  const ideas = ["@Artemis how is our AI visibility?", "@Aphrodite plan posts", "@Hephaestus outline a page", "@Iris write an email", "What can my team do?"];
  assert.deepEqual(homeIdeas(ideas, { arrowsterr: false, capybaroar: false }), ["@Iris write an email", "What can my team do?"]);
  assert.deepEqual(homeIdeas(ideas, { arrowsterr: true, capybaroar: true }, 3), ideas.slice(0, 3));
  assert.deepEqual(homeIdeas(ideas, { arrowsterr: false, capybaroar: true }), ["@Aphrodite plan posts", "@Iris write an email", "What can my team do?"]);
});

const ALL_APPS = ["gmail", "outlook", "googlecalendar", "calendly", "slack", "shopify", "framer", "webflow", "wordpress_com"];
const fresh: SetupState = { canConnect: true, socialAccounts: 0, connected: [], connectable: ALL_APPS, wordpress: false };

test("finishSetup: every row for a new workspace, in order, each with its logos and connect flow", () => {
  const rows = finishSetup(fresh);
  assert.deepEqual(rows.map((r) => r.key), ["social", "email", "calendar", "website"]);
  assert.deepEqual(rows[0].connect, { kind: "social" });
  assert.deepEqual(rows[1].connect, { kind: "apps", apps: ["gmail", "outlook"] });
  assert.deepEqual(rows[2].connect, { kind: "apps", apps: ["googlecalendar", "calendly"] });
  assert.deepEqual(rows[3].connect, { kind: "page", path: "/settings/apps" });
  assert.deepEqual(rows[1].logos, ["gmail", "outlook"]);
  for (const r of rows) {
    assert.ok(r.logos.length > 0);
    assert.doesNotMatch(`${r.title} ${r.text}`, /[–—]|capybaroar|arrowsterr|composio/i);
  }
});

test("finishSetup: finished rows go, and the section empties when all is done", () => {
  assert.deepEqual(finishSetup({ ...fresh, socialAccounts: 2 }).map((r) => r.key), ["email", "calendar", "website"]);
  // Either mail app finishes the email row, and either calendar app the calendar row.
  assert.deepEqual(finishSetup({ ...fresh, connected: ["outlook", "calendly"] }).map((r) => r.key), ["social", "website"]);
  // Any site builder finishes the website row, a self-hosted WordPress site too.
  assert.deepEqual(finishSetup({ ...fresh, connected: ["framer"] }).map((r) => r.key), ["social", "email", "calendar"]);
  assert.deepEqual(finishSetup({ ...fresh, wordpress: true }).map((r) => r.key), ["social", "email", "calendar"]);
  assert.deepEqual(finishSetup({ ...fresh, socialAccounts: 1, connected: ["gmail", "googlecalendar", "shopify"] }), []);
});

test("finishSetup: owners and admins only, and only apps this server can connect", () => {
  assert.deepEqual(finishSetup({ ...fresh, canConnect: false }), []);
  // No app sign-in on this server: the email and calendar rows can't be done here, so they don't show.
  assert.deepEqual(finishSetup({ ...fresh, connectable: [] }).map((r) => r.key), ["social", "website"]);
  const some = finishSetup({ ...fresh, connectable: ["outlook"] });
  assert.deepEqual(some.find((r) => r.key === "email")?.connect, { kind: "apps", apps: ["outlook"] });
});

test("reachChannels: only the doors this workspace has, in order", () => {
  assert.deepEqual(reachChannels({}), []);
  assert.deepEqual(reachChannels({ emailAddress: "  ", textNumber: null, slackTeam: false }), []);
  assert.deepEqual(
    reachChannels({ slackTeam: true, textNumber: "+1 555 0100", emailAddress: "team@acme.morningtelos.com" }).map((c) => [c.id, c.label, c.detail]),
    [
      ["email", "Email", "team@acme.morningtelos.com"],
      ["text", "Text", "+1 555 0100"],
      ["slack", "Slack", "Message your team in Slack"],
    ],
  );
  assert.deepEqual(reachChannels({ emailAddress: "team@acme.morningtelos.com" }).map((c) => c.id), ["email"]);
});

test("showSlackBanner: owners and admins, Slack ready here, not connected, not dismissed", () => {
  const on = { canConnect: true, slackReady: true, slackConnected: false, dismissed: false };
  assert.equal(showSlackBanner(on), true);
  assert.equal(showSlackBanner({ ...on, canConnect: false }), false);
  assert.equal(showSlackBanner({ ...on, slackReady: false }), false);
  assert.equal(showSlackBanner({ ...on, slackConnected: true }), false);
  assert.equal(showSlackBanner({ ...on, dismissed: true }), false);
  // Kept per person and per workspace.
  assert.notEqual(slackBannerKey("u1", "w1"), slackBannerKey("u2", "w1"));
  assert.notEqual(slackBannerKey("u1", "w1"), slackBannerKey("u1", "w2"));
});

test("paletteMatch: every typed word must match", () => {
  const items: PaletteItem[] = [
    { label: "Home", group: "Pages", path: "/" },
    { label: "Artemis, SEO Specialist", group: "Teammates", path: "/team/seo" },
    { label: "How visible are we", group: "Chats", path: "/chat/1", keywords: "seo" },
  ];
  assert.equal(paletteMatch(items, "").length, 3);
  assert.deepEqual(paletteMatch(items, "seo").map((i) => i.path), ["/team/seo", "/chat/1"]);
  assert.deepEqual(paletteMatch(items, "artemis  seo").map((i) => i.path), ["/team/seo"]);
  assert.deepEqual(paletteMatch(items, "zzz"), []);
});
