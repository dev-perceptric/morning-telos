// The work tabs' calendar dates (src/lib/calendar.ts). Weeks start on Monday.
import assert from "node:assert/strict";
import test from "node:test";
import { fromInputs, inputsOf, sameDay, step, viewDays, viewTitle, weekStart } from "../src/lib/calendar.ts";

const d = (s: string) => new Date(`${s}T12:00:00`);

test("weekStart is the Monday at midnight, Sunday included in the week before it", () => {
  assert.equal(weekStart(d("2026-11-21")).toDateString(), new Date(2026, 10, 16).toDateString());
  assert.equal(weekStart(d("2026-11-22")).toDateString(), new Date(2026, 10, 16).toDateString());
  assert.equal(weekStart(d("2026-11-23")).toDateString(), new Date(2026, 10, 23).toDateString());
  assert.equal(weekStart(d("2026-11-23")).getHours(), 0);
});

test("viewDays: 7 days for a week, a 6 week grid for a month, and the range to load", () => {
  const w = viewDays("week", d("2026-11-19"));
  assert.equal(w.days.length, 7);
  assert.ok(sameDay(w.days[0], new Date(2026, 10, 16)));
  assert.ok(sameDay(w.to, new Date(2026, 10, 23)));
  const m = viewDays("month", d("2026-11-19"));
  assert.equal(m.days.length, 42);
  assert.ok(sameDay(m.days[0], new Date(2026, 9, 26)), "the Monday before November 1");
  assert.equal(m.month, 10);
  assert.ok((m.to.getTime() - m.from.getTime()) / 86_400_000 <= 92, "inside Capybaroar's limit");
});

test("step and viewTitle", () => {
  assert.ok(sameDay(step("week", d("2026-11-19"), 1), new Date(2026, 10, 23)));
  assert.ok(sameDay(step("week", d("2026-11-19"), -1), new Date(2026, 10, 9)));
  assert.ok(sameDay(step("month", d("2026-11-19"), 1), new Date(2026, 11, 1)));
  assert.ok(sameDay(step("month", d("2026-01-19"), -1), new Date(2025, 11, 1)));
  assert.equal(viewTitle("week", d("2026-11-19")), "Nov 16 to Nov 22");
  assert.equal(viewTitle("month", d("2026-11-19")), "November 2026");
});

test("inputsOf and fromInputs round trip, and reject bad input", () => {
  const when = new Date(2027, 0, 5, 9, 30);
  const i = inputsOf(when);
  assert.deepEqual(i, { day: "2027-01-05", time: "09:30" });
  assert.equal(fromInputs(i.day, i.time), when.toISOString());
  assert.equal(fromInputs("", "09:00"), null);
  assert.equal(fromInputs("2027-01-05", "9am"), null);
  assert.equal(fromInputs("2027-13-45", "09:00"), null);
});
