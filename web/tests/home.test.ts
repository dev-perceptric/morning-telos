import assert from "node:assert/strict";
import test from "node:test";
import { ago, firstName, greeting, homeIdeas, initial, paletteMatch, setupSteps, trialPill, type PaletteItem } from "../src/lib/home.ts";
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

test("setupSteps: what's left, in order, for what the person can do", () => {
  const all = setupSteps({ docs: 0, services: [{ product: "arrowsterr", status: "pending" }], socialConnected: false, appsConnected: false, canSocial: true, canApps: true, canKnowledge: true });
  assert.deepEqual(all.map((s) => s.key), ["knowledge", "seo", "social", "apps"]);
  assert.equal(all[1].meta, "In progress");
  assert.equal(all[1].action, undefined);
  assert.equal(all[2].connect, true);
  const waiting = setupSteps({ docs: 2, services: [{ product: "arrowsterr", status: "waiting" }], socialConnected: true, appsConnected: true, canSocial: true, canApps: true, canKnowledge: true });
  assert.deepEqual(waiting.map((s) => [s.key, s.action?.path]), [["seo", "/settings"]]);
  assert.equal(setupSteps({ docs: 0, services: [{ product: "arrowsterr", status: "failed" }], socialConnected: false, appsConnected: false, canSocial: false, canApps: false, canKnowledge: false })[0].meta, "We're on it");
  assert.deepEqual(setupSteps({ docs: 1, services: [{ product: "arrowsterr", status: "ready" }], socialConnected: true, appsConnected: true, canSocial: true, canApps: true, canKnowledge: true }), []);
  for (const s of all) assert.doesNotMatch(`${s.title} ${s.text}`, /[–—]/);
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
