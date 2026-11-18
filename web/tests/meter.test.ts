// The AI meter (src/lib/meter.ts): cost math, the price table, when a period starts, and the caps.
import assert from "node:assert/strict";
import { test } from "node:test";
import { aiBlock, CAP_MESSAGES, costOf, PRICES, spendWindowStart, tokensOf, UNKNOWN_PRICE } from "../src/lib/meter.ts";
import { MODELS } from "../src/lib/models.ts";
import { PLANS } from "../src/lib/plans.ts";

const NOW = Date.parse("2026-11-18T12:00:00Z");
const day = (n: number) => new Date(NOW + n * 864e5).toISOString();

test("every model the team can run has a price", () => {
  for (const id of new Set(Object.values(MODELS))) assert.ok(PRICES[id], `${id} has no price in meter.ts`);
});

test("cache writes cost 1.25x input on every model", () => {
  for (const [id, p] of Object.entries(PRICES)) {
    assert.equal(p.cacheWrite, p.input * 1.25, id);
    if (p.long) assert.equal(p.long.cacheWrite, p.long.input * 1.25, `${id} long`);
  }
});

test("costOf: input, output, cache reads and writes, to the millionth", () => {
  assert.equal(costOf("claude-opus-5-5", { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 }), 4);
  assert.equal(costOf("claude-opus-5-5", { input: 0, output: 1_000_000, cacheRead: 0, cacheWrite: 0 }), 20);
  assert.equal(costOf("claude-opus-5-5", { input: 0, output: 0, cacheRead: 1_000_000, cacheWrite: 0 }), 0.2);
  assert.equal(costOf("claude-opus-5-5", { input: 0, output: 0, cacheRead: 0, cacheWrite: 1_000_000 }), 5);
  assert.equal(costOf("claude-sonnet-5-5", { input: 1000, output: 500, cacheRead: 10_000, cacheWrite: 2000 }), 0.014);
  assert.equal(costOf("claude-haiku-5-5", { input: 1000, output: 1000, cacheRead: 0, cacheWrite: 0 }), 0.0006);
  assert.equal(costOf("claude-opus-5-5", { input: 1, output: 0, cacheRead: 0, cacheWrite: 0 }), 0.000004);
  assert.equal(costOf("claude-opus-5-5", { input: -5, output: Number.NaN, cacheRead: 0, cacheWrite: 0 }), 0);
});

test("Haiku 5.5 prompts over 100K tokens use the higher rates", () => {
  assert.equal(costOf("claude-haiku-5-5", { input: 100_000, output: 0, cacheRead: 0, cacheWrite: 0 }), 0.01);
  assert.equal(costOf("claude-haiku-5-5", { input: 100_001, output: 1000, cacheRead: 0, cacheWrite: 0 }), Math.round(((100_001 * 0.5 + 1000 * 2.5) / 1e6) * 1e6) / 1e6);
  // Cached tokens count toward the prompt size.
  assert.ok(costOf("claude-haiku-5-5", { input: 10, output: 0, cacheRead: 200_000, cacheWrite: 0 }) > costOf("claude-haiku-5-5", { input: 10, output: 0, cacheRead: 90_000, cacheWrite: 0 }) * 2);
});

test("an unknown model is priced at Opus 5 rates, never free", () => {
  const t = { input: 1000, output: 1000, cacheRead: 0, cacheWrite: 0 };
  assert.equal(costOf("claude-something-new", t), costOf("claude-opus-5", t));
  assert.ok(UNKNOWN_PRICE.input >= PRICES["claude-opus-5-5"].input);
});

test("tokensOf reads the API's usage, missing fields as 0", () => {
  assert.deepEqual(tokensOf({ input_tokens: 5, output_tokens: 6, cache_read_input_tokens: null, cache_creation_input_tokens: 7 }), { input: 5, output: 6, cacheRead: 0, cacheWrite: 7 });
  assert.deepEqual(tokensOf(undefined), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
});

test("spendWindowStart: the trial counts from its start, a paid plan from its billing period", () => {
  assert.equal(spendWindowStart({ plan: "trial", status: "trialing", trial_ends_at: day(10) }, NOW), day(-4));
  assert.equal(spendWindowStart({ plan: "pro", status: "active", trial_ends_at: day(-40), period_start: day(-12) }, NOW), day(-12));
  // A period start older than a month (a missed webhook) or in the future counts the last 31 days.
  assert.equal(spendWindowStart({ plan: "pro", status: "active", trial_ends_at: day(-90), period_start: day(-60) }, NOW), day(-31));
  assert.equal(spendWindowStart({ plan: "starter", status: "active", trial_ends_at: day(-90), period_start: day(2) }, NOW), day(-31));
  assert.equal(spendWindowStart({ plan: "starter", status: "active", trial_ends_at: day(-90), period_start: null }, NOW), day(-31));
});

test("aiBlock: expired plans stop, the allowance stops at its limit, under it runs", () => {
  const trial = { plan: "trial", status: "trialing", trial_ends_at: day(3) };
  assert.equal(aiBlock(trial, 0, NOW), null);
  assert.equal(aiBlock(trial, PLANS.trial.aiAllowance - 0.01, NOW), null);
  assert.deepEqual(aiBlock(trial, PLANS.trial.aiAllowance, NOW), { reason: "allowance", text: CAP_MESSAGES.trialAllowance });
  assert.deepEqual(aiBlock({ ...trial, trial_ends_at: day(-1) }, 0, NOW), { reason: "expired", text: CAP_MESSAGES.trialOver });
  const starter = { plan: "starter", status: "active", trial_ends_at: day(-30) };
  assert.equal(aiBlock(starter, 11.99, NOW), null);
  assert.deepEqual(aiBlock(starter, 12, NOW), { reason: "allowance", text: CAP_MESSAGES.allowance });
  assert.equal(aiBlock({ plan: "pro", status: "past_due", trial_ends_at: day(-30) }, 49, NOW), null, "past due keeps the plan while Stripe retries");
  assert.deepEqual(aiBlock({ plan: "pro", status: "canceled", trial_ends_at: day(-30) }, 0, NOW), { reason: "expired", text: CAP_MESSAGES.stopped });
  assert.deepEqual(aiBlock({ plan: "pro", status: "unpaid", trial_ends_at: day(-30) }, 0, NOW), { reason: "expired", text: CAP_MESSAGES.stopped });
});

test("cap messages are plain: short sentences, no dashes", () => {
  for (const m of Object.values(CAP_MESSAGES)) {
    assert.doesNotMatch(m, /[—–]/);
    for (const s of m.split(/(?<=\.)\s/)) assert.ok(s.split(" ").length <= 16, `long sentence: ${s}`);
  }
});
