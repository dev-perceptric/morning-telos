// The approvals count on the toolbar icon (src/badge.js).
import assert from "node:assert/strict";
import test from "node:test";
import { badgeText, badgeTitle } from "../src/badge.js";

test("badgeText: nothing for none, the number, then 99+", () => {
  assert.equal(badgeText(0), "");
  assert.equal(badgeText(-2), "");
  assert.equal(badgeText(undefined), "");
  assert.equal(badgeText("x"), "");
  assert.equal(badgeText(1), "1");
  assert.equal(badgeText(42), "42");
  assert.equal(badgeText(99), "99");
  assert.equal(badgeText(100), "99+");
  assert.equal(badgeText(3.7), "3");
});

test("badgeTitle says how many wait for an OK", () => {
  assert.equal(badgeTitle(0), "Morning Telos");
  assert.equal(badgeTitle(2), "Morning Telos: 2 waiting for your OK");
  assert.equal(badgeTitle(500), "Morning Telos: 99+ waiting for your OK");
});
