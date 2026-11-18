// Which trial and lifecycle emails are due, with fixed dates and time zones (src/lib/lifecycle.ts).
import assert from "node:assert/strict";
import test from "node:test";
import { addDays, allowancePeriod, digestWeek, dueEmails, localDate, needsSpend, trialTimes, weekday, zonedTime, zoneOf, type LifecycleWorkspace } from "../src/lib/lifecycle.ts";

const T = (iso: string) => Date.parse(iso);
// A trial that ends at 3:30 PM in Chicago (CST, UTC-6) on Monday, Nov 30 2026. It started Nov 16.
const ENDS = "2026-11-30T21:30:00.000Z";
const trial: LifecycleWorkspace = { id: "w1", plan: "trial", status: "trialing", trial_ends_at: ENDS, timezone: "America/Chicago", created_at: "2026-11-16T21:30:00.000Z" };
const kinds = (ws: LifecycleWorkspace, iso: string, spentUsd: number | null = 0) => dueEmails(ws, { now: T(iso), spentUsd }).map((d) => d.kind);

test("time zone helpers", () => {
  assert.equal(localDate(T("2026-11-23T05:59:00Z"), "America/Chicago"), "2026-11-22");
  assert.equal(localDate(T("2026-11-23T06:00:00Z"), "America/Chicago"), "2026-11-23");
  assert.equal(addDays("2026-11-30", 1), "2026-12-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(weekday("2026-11-23"), 1);
  assert.equal(new Date(zonedTime("2026-11-23", 9, "America/Chicago")).toISOString(), "2026-11-23T15:00:00.000Z");
  // Daylight saving time started at 2 AM on Mar 8 2026, so 9 AM is CDT (UTC-5).
  assert.equal(new Date(zonedTime("2026-03-08", 9, "America/Chicago")).toISOString(), "2026-03-08T14:00:00.000Z");
  assert.equal(new Date(zonedTime("2026-11-23", 9, "Asia/Ho_Chi_Minh")).toISOString(), "2026-11-23T02:00:00.000Z");
  assert.equal(new Date(zonedTime("2026-11-23", 9, "Asia/Kolkata")).toISOString(), "2026-11-23T03:30:00.000Z");
  assert.equal(zoneOf("Not/AZone"), "America/Chicago");
  assert.equal(zoneOf(null), "America/Chicago");
  assert.equal(zoneOf("Europe/Paris"), "Europe/Paris");
});

test("trial emails go at 9 AM local on day 7, 2 days before the end, the last day and the morning after", () => {
  const t = trialTimes(T(ENDS), "America/Chicago");
  assert.deepEqual(
    Object.fromEntries(Object.entries(t).map(([k, v]) => [k, new Date(v).toISOString()])),
    { day7: "2026-11-22T15:00:00.000Z", day12: "2026-11-28T15:00:00.000Z", lastDay: "2026-11-30T15:00:00.000Z", ended: "2026-12-01T15:00:00.000Z" },
  );
});

test("a trial that ends before 10 AM gets its last-day email the morning before", () => {
  const t = trialTimes(T("2026-11-30T13:00:00Z"), "America/Chicago"); // 7 AM CST
  assert.equal(new Date(t.lastDay).toISOString(), "2026-11-29T15:00:00.000Z");
  assert.equal(new Date(t.day12).toISOString(), "2026-11-28T15:00:00.000Z");
});

test("each trial email is due in its own window only, keyed by the trial's end", () => {
  assert.deepEqual(kinds(trial, "2026-11-22T14:59:00Z"), []);
  assert.deepEqual(dueEmails(trial, { now: T("2026-11-22T15:00:00Z"), spentUsd: 0 }), [{ kind: "trial_day7", periodKey: "2026-11-30" }]);
  assert.deepEqual(kinds(trial, "2026-11-27T20:00:00Z"), ["trial_day7"]);
  assert.deepEqual(kinds(trial, "2026-11-28T15:00:00Z"), ["trial_day12"]);
  // Nov 30 is a Monday, so the weekly digest is due too.
  assert.deepEqual(kinds(trial, "2026-11-30T16:00:00Z"), ["trial_last_day", "weekly_digest"]);
  // Ended, but it's not the next morning yet.
  assert.deepEqual(kinds(trial, "2026-11-30T22:00:00Z"), []);
  assert.deepEqual(dueEmails(trial, { now: T("2026-12-01T15:00:00Z"), spentUsd: null }), [{ kind: "trial_ended", periodKey: "2026-11-30" }]);
  assert.deepEqual(kinds(trial, "2026-12-03T20:00:00Z", null), ["trial_ended"]);
  // Too late: the worker was down for days, so it stays quiet.
  assert.deepEqual(kinds(trial, "2026-12-05T15:00:00Z", null), []);
});

test("no trial emails once a plan is paid for, and no paused email for a canceled plan or a payment going through", () => {
  const paid = { ...trial, plan: "starter", status: "active", period_start: "2026-11-25T00:00:00Z" };
  assert.deepEqual(kinds(paid, "2026-11-28T15:00:00Z"), []);
  assert.deepEqual(kinds({ ...paid, status: "canceled" }, "2026-12-01T15:00:00Z", null), []);
  assert.deepEqual(kinds({ ...trial, status: "incomplete" }, "2026-12-01T15:00:00Z", null), []);
  assert.deepEqual(kinds({ ...trial, plan: "internal" }, "2026-11-22T15:00:00Z", null), []);
});

test("a workspace made after day 7 skips the day 7 email", () => {
  assert.deepEqual(kinds({ ...trial, created_at: "2026-11-25T00:00:00Z" }, "2026-11-26T15:00:00Z"), []);
});

test("ai_80 goes once per allowance period at 80% or more", () => {
  assert.deepEqual(kinds(trial, "2026-11-20T12:00:00Z", 3.99), []);
  assert.deepEqual(dueEmails(trial, { now: T("2026-11-20T12:00:00Z"), spentUsd: 4 }), [{ kind: "ai_80", periodKey: "trial:2026-11-16" }]);
  assert.deepEqual(kinds(trial, "2026-11-20T12:00:00Z", null), [], "no spend read, no email");
  const paid: LifecycleWorkspace = { id: "w2", plan: "pro", status: "active", trial_ends_at: "2026-10-01T00:00:00Z", period_start: "2026-11-10T08:00:00.000Z", timezone: "UTC" };
  assert.deepEqual(dueEmails(paid, { now: T("2026-11-20T12:00:00Z"), spentUsd: 41 }), [{ kind: "ai_80", periodKey: "pro:2026-11-10" }]);
  assert.deepEqual(kinds(paid, "2026-11-20T12:00:00Z", 39), []);
  // A stale period_start (a missed webhook) keys by month, so it never goes out every day.
  assert.equal(allowancePeriod({ ...paid, period_start: "2026-08-01T00:00:00Z" }, T("2026-11-20T12:00:00Z")), "pro:2026-11");
  assert.equal(allowancePeriod({ ...paid, period_start: "2026-08-01T00:00:00Z" }, T("2026-11-21T12:00:00Z")), "pro:2026-11");
});

test("needsSpend: only plans with an allowance that can run out", () => {
  const now = T("2026-11-20T12:00:00Z");
  assert.equal(needsSpend(trial, now), true);
  assert.equal(needsSpend({ ...trial, plan: "starter", status: "active" }, now), true);
  assert.equal(needsSpend({ ...trial, plan: "internal" }, now), false);
  assert.equal(needsSpend({ ...trial, trial_ends_at: "2026-11-01T00:00:00Z" }, now), false);
});

test("the weekly digest goes on Monday from 9 AM local, keyed by that Monday", () => {
  const ws: LifecycleWorkspace = { id: "w3", plan: "starter", status: "active", trial_ends_at: "2026-10-01T00:00:00Z", period_start: "2026-11-10T00:00:00Z", timezone: "America/Chicago", created_at: "2026-09-01T00:00:00Z" };
  assert.deepEqual(kinds(ws, "2026-11-23T14:59:00Z"), []);
  assert.deepEqual(dueEmails(ws, { now: T("2026-11-23T15:00:00Z"), spentUsd: 0 }), [{ kind: "weekly_digest", periodKey: "2026-11-23" }]);
  assert.deepEqual(kinds(ws, "2026-11-24T05:59:00Z"), ["weekly_digest"], "still Monday in Chicago");
  assert.deepEqual(kinds(ws, "2026-11-24T15:00:00Z"), []);
  // Monday 9 AM in Ho Chi Minh City is 2 AM UTC.
  assert.deepEqual(kinds({ ...ws, timezone: "Asia/Ho_Chi_Minh" }, "2026-11-23T02:00:00Z"), ["weekly_digest"]);
  assert.deepEqual(kinds({ ...ws, created_at: "2026-11-21T00:00:00Z" }, "2026-11-23T15:00:00Z"), [], "too new");
  assert.deepEqual(kinds({ ...ws, status: "canceled" }, "2026-11-23T15:00:00Z", null), [], "paused teams get no digest");
});

test("the digest covers last Monday to this Monday, midnight to midnight local", () => {
  assert.deepEqual(digestWeek(T("2026-11-23T15:00:00Z"), "America/Chicago"), { from: "2026-11-16T06:00:00.000Z", to: "2026-11-23T06:00:00.000Z" });
  assert.deepEqual(digestWeek(T("2026-11-23T02:00:00Z"), "Asia/Ho_Chi_Minh"), { from: "2026-11-15T17:00:00.000Z", to: "2026-11-22T17:00:00.000Z" });
});
