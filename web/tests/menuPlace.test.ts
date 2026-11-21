import assert from "node:assert/strict";
import { test } from "node:test";
import { menuPlace } from "../src/lib/menuPlace.ts";

test("the menu opens below its button when there is room", () => {
  assert.deepEqual(menuPlace({ top: 590, bottom: 620, left: 680 }, 1440, 1300), { position: "fixed", left: 680, top: 624, maxHeight: 320 });
});

test("the menu opens above when the button is near the bottom", () => {
  const p = menuPlace({ top: 1200, bottom: 1230, left: 680 }, 1440, 1300);
  assert.equal(p.top, undefined);
  assert.equal(p.bottom, 104);
  assert.equal(p.maxHeight, 320);
});

test("the menu fits the room it has and stays inside the window", () => {
  const p = menuPlace({ top: 300, bottom: 330, left: 1300 }, 1440, 600);
  assert.equal(p.left, 1440 - 240 - 8);
  assert.equal(p.top, 334);
  assert.equal(p.maxHeight, 600 - 330 - 4 - 8);
  assert.equal(menuPlace({ top: 10, bottom: 40, left: -5 }, 400, 300).left, 8);
});
