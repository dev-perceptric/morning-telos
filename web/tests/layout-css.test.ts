// Layout rules found in a phone and desktop check of production, kept by reading the stylesheets.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const css = (f: string) => readFileSync(new URL(`../src/app/${f}`, import.meta.url), "utf8");
const rule = (sheet: string, selector: string) => {
  // The rule that starts a line (or follows a media query's indent), not one that shares a selector list.
  const m = new RegExp(`(^|\\n)\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\{`).exec(sheet);
  const at = m ? m.index + m[0].length - selector.length - 1 : -1;
  assert.ok(at >= 0, `no rule for ${selector}`);
  return sheet.slice(at, sheet.indexOf("}", at));
};

test("a closed side sheet is hidden, so its shadow never shows at the screen's edge", () => {
  const mt = css("mt.css");
  assert.match(rule(mt, ".dw"), /visibility:hidden/);
  assert.match(rule(mt, ".dw-wrap.on .dw"), /visibility:visible/);
});

test("table cards break only long words, so short words never split across lines on a phone", () => {
  const td = rule(css("cards.css"), ".atable td");
  assert.doesNotMatch(td, /overflow-wrap:anywhere|word-break:break-all/);
  assert.match(td, /overflow-wrap:break-word/);
});

test("the message box sits flush on the bottom (or on the phone's tab bar), so no chat text shows under it", () => {
  const mt = css("mt.css");
  const dock = rule(mt, ".dock");
  assert.match(dock, /bottom:0/);
  assert.match(dock, /padding-bottom:/);
  assert.match(mt, /\.dock\{bottom:calc\(var\(--tab-h\) \+ env\(safe-area-inset-bottom\)\);padding-bottom:/);
});
