// Routines (src/lib/routines.ts): the form check, how a schedule reads, and the skip notes. Which minute is due is
// in SQL (due_routines), tested in rls.test.ts.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CAP_MESSAGES } from "../src/lib/meter.ts";
import { cleanRoutine, daysText, MAX_INSTRUCTION, routineThreadTitle, SKIP_NOTES, timeText } from "../src/lib/routines.ts";

const ok = { agent: "social", title: "  Plan   the week ", instruction: " Draft 5 posts.\r\nUse photos. ", days: [5, 1, "3", 1], at_time: "08:30" };

test("cleanRoutine: a working teammate, a name, what to do, at least one day and a time", () => {
  assert.deepEqual(cleanRoutine(ok), { ok: true, value: { agent: "social", title: "Plan the week", instruction: "Draft 5 posts.\nUse photos.", days: [1, 3, 5], at_time: "08:30" } });
  assert.deepEqual(cleanRoutine({ ...ok, agent: "sales" }), { ok: false, error: "Pick a teammate." }, "coming soon");
  assert.deepEqual(cleanRoutine({ ...ok, agent: "zeus" }), { ok: false, error: "Pick a teammate." });
  assert.deepEqual(cleanRoutine({ ...ok, title: " " }), { ok: false, error: "Give the routine a name." });
  assert.equal(cleanRoutine({ ...ok, title: "x".repeat(121) }).ok, false);
  assert.deepEqual(cleanRoutine({ ...ok, instruction: "" }), { ok: false, error: "Say what the teammate should do." });
  assert.equal(cleanRoutine({ ...ok, instruction: "x".repeat(MAX_INSTRUCTION + 1) }).ok, false);
  assert.deepEqual(cleanRoutine({ ...ok, days: [] }), { ok: false, error: "Pick at least one day." });
  assert.deepEqual(cleanRoutine({ ...ok, days: [7, -1, 2.5, "x"] }), { ok: false, error: "Pick at least one day." });
  for (const t of ["8:30", "24:00", "08:60", "", "08:30:00"]) assert.deepEqual(cleanRoutine({ ...ok, at_time: t }), { ok: false, error: "Pick a time." }, t);
  assert.equal(cleanRoutine({ ...ok, at_time: "23:59" }).ok, true);
  assert.equal(cleanRoutine({ ...ok, agent: "chief" }).ok, true);
});

test("daysText and timeText read the schedule in plain words", () => {
  assert.equal(daysText([0, 1, 2, 3, 4, 5, 6]), "Every day");
  assert.equal(daysText([5, 4, 3, 2, 1]), "Weekdays");
  assert.equal(daysText([6, 0]), "Weekends");
  assert.equal(daysText([1, 3, 5, 3]), "Mon, Wed, Fri");
  assert.equal(timeText("08:00"), "8:00 AM");
  assert.equal(timeText("00:05"), "12:05 AM");
  assert.equal(timeText("12:30"), "12:30 PM");
  assert.equal(timeText("17:45"), "5:45 PM");
  assert.equal(timeText("bad"), "bad");
});

test("a run's chat title, and the notes left when a run is skipped", () => {
  assert.equal(routineThreadTitle("Plan the week"), "Routine: Plan the week");
  assert.equal(routineThreadTitle("x".repeat(300)).length, 200);
  assert.equal(SKIP_NOTES.paused("social"), "Skipped: Aphrodite is paused. Turn them back on in Team.");
  assert.equal(SKIP_NOTES.blocked(CAP_MESSAGES.allowance), `Skipped. ${CAP_MESSAGES.allowance}`);
  for (const n of [SKIP_NOTES.paused("seo"), SKIP_NOTES.soon("sales"), SKIP_NOTES.starting, SKIP_NOTES.blocked(CAP_MESSAGES.trialAllowance)]) assert.ok(n.length <= 300);
});
