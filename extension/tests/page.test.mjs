// The page reader (src/page.js) with stand-in pages: cleaning, the size caps, the article choice and the password box.
import assert from "node:assert/strict";
import test from "node:test";
import { LIMITS } from "../src/config.js";
import { peekPage, readPage } from "../src/page.js";
import { FakeEl, fakeDoc } from "./fakeDom.mjs";

const loc = { href: "https://example.com/menu" };

test("cleans the page's words: no invisible characters, single spaces, at most one empty line", () => {
  const body = new FakeEl({ text: "  Fresh   bread\u200B daily \r\n\r\n\r\n\r\n  Open\t9 to 5  \u0007\n" });
  const out = readPage(LIMITS, fakeDoc({ title: "  Ana's \n Bakery ", body }), loc);
  assert.equal(out.text, "Fresh bread daily\n\nOpen 9 to 5");
  assert.equal(out.title, "Ana's Bakery");
  assert.equal(out.url, "https://example.com/menu");
  assert.equal(out.cut, false);
});

test("caps the text, title and selection, and says when the page was cut", () => {
  const long = "word ".repeat(10000);
  const out = readPage({ text: 1000, selection: 50, title: 20 }, fakeDoc({ title: "T".repeat(100), body: new FakeEl({ text: long }), selection: "pick ".repeat(100) }), loc);
  assert.ok(out.text.length <= 1000 && out.text.length > 900);
  assert.ok(!out.text.endsWith(" "));
  assert.equal(out.title.length, 20);
  assert.ok(out.selection.length <= 50);
  assert.equal(out.cut, true);
  // The real limits match the server's (web/src/lib/pageContext.ts).
  assert.deepEqual(LIMITS, { text: 20000, selection: 5000, title: 300 });
});

test("uses the article when it holds the page, else the whole body", () => {
  const article = new FakeEl({ text: "Story ".repeat(200), matches: ["article"] });
  const body = new FakeEl({ text: "Menu Login Story...", kids: [article] });
  assert.match(readPage(LIMITS, fakeDoc({ body }), loc).text, /^Story Story/);
  const tiny = new FakeEl({ text: "Short", matches: ["article"] });
  const body2 = new FakeEl({ text: "Whole page words", kids: [tiny] });
  assert.equal(readPage(LIMITS, fakeDoc({ body: body2 }), loc).text, "Whole page words");
});

test("a page with a password box is never read: no text comes back", () => {
  const pw = new FakeEl({ matches: ['input[type="password" i]'] });
  const body = new FakeEl({ text: "Secret account page", kids: [pw] });
  const out = readPage(LIMITS, fakeDoc({ body }), loc);
  assert.deepEqual(out, { blocked: "password", url: loc.href });
  assert.deepEqual(peekPage(fakeDoc({ body }), loc), { url: loc.href, password: true });
  assert.deepEqual(peekPage(fakeDoc({ body: new FakeEl({ text: "hi" }) }), loc), { url: loc.href, password: false });
});

test("readPage and peekPage use nothing outside themselves, so Chrome can run them in the tab", () => {
  for (const fn of [readPage, peekPage]) {
    const copy = new Function(`return (${fn.toString()})`)();
    assert.equal(typeof copy, "function");
  }
  const copy = new Function(`return (${readPage.toString()})`)();
  assert.equal(copy(LIMITS, fakeDoc({ body: new FakeEl({ text: "a  b" }) }), loc).text, "a b");
});
