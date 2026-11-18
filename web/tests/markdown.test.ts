import assert from "node:assert/strict";
import test from "node:test";
import { inlineMd, parseMarkdown, safeHref } from "../src/lib/markdown.ts";

test("parseMarkdown: paragraphs keep their lines, blank lines split them", () => {
  assert.deepEqual(parseMarkdown("Hi there.\nSecond line.\n\nNew paragraph."), [
    { kind: "p", lines: [[{ kind: "text", text: "Hi there." }], [{ kind: "text", text: "Second line." }]] },
    { kind: "p", lines: [[{ kind: "text", text: "New paragraph." }]] },
  ]);
});

test("parseMarkdown: - lists and numbered lists, with bold inside", () => {
  const blocks = parseMarkdown("**When it's ready:**\n- **Where you stand:** how often\n- Who wins\n\n1. Your basics\n2. The questions");
  assert.deepEqual(blocks, [
    { kind: "p", lines: [[{ kind: "bold", text: "When it's ready:" }]] },
    { kind: "ul", items: [[{ kind: "bold", text: "Where you stand:" }, { kind: "text", text: " how often" }], [{ kind: "text", text: "Who wins" }]] },
    { kind: "ol", start: 1, items: [[{ kind: "text", text: "Your basics" }], [{ kind: "text", text: "The questions" }]] },
  ]);
});

test("parseMarkdown: a list right after a line, a list that starts at 3, and headings", () => {
  const blocks = parseMarkdown("Steps:\n3. Third\n4. Fourth\n## Next up\n* star item");
  assert.equal(blocks[0].kind, "p");
  assert.deepEqual(blocks[1], { kind: "ol", start: 3, items: [[{ kind: "text", text: "Third" }], [{ kind: "text", text: "Fourth" }]] });
  assert.deepEqual(blocks[2], { kind: "h", parts: [{ kind: "text", text: "Next up" }] });
  assert.deepEqual(blocks[3], { kind: "ul", items: [[{ kind: "text", text: "star item" }]] });
});

test("parseMarkdown: an indented line continues the list item above", () => {
  assert.deepEqual(parseMarkdown("- one\n  more of one\n- two"), [{ kind: "ul", items: [[{ kind: "text", text: "one more of one" }], [{ kind: "text", text: "two" }]] }]);
});

test("inlineMd: code, links and bare addresses; HTML stays text", () => {
  assert.deepEqual(inlineMd("Run `npm test` then see [the docs](https://example.com/a) or https://example.com/b."), [
    { kind: "text", text: "Run " },
    { kind: "code", text: "npm test" },
    { kind: "text", text: " then see " },
    { kind: "link", text: "the docs", href: "https://example.com/a" },
    { kind: "text", text: " or " },
    { kind: "link", text: "https://example.com/b", href: "https://example.com/b" },
    { kind: "text", text: "." },
  ]);
  assert.deepEqual(inlineMd("<b>not html</b> **"), [{ kind: "text", text: "<b>not html</b> **" }]);
  assert.deepEqual(inlineMd("[x](javascript:alert(1))"), [{ kind: "text", text: "[x](javascript:alert(1))" }]);
  assert.deepEqual(inlineMd(""), []);
});

test("safeHref: only http and https", () => {
  assert.equal(safeHref("https://a.com/x?y=1"), "https://a.com/x?y=1");
  assert.equal(safeHref("http://a.com"), "http://a.com/");
  assert.equal(safeHref("javascript:alert(1)"), null);
  assert.equal(safeHref("data:text/html,hi"), null);
  assert.equal(safeHref("not a url"), null);
});

test("parseMarkdown: empty and odd input", () => {
  assert.deepEqual(parseMarkdown(""), []);
  assert.deepEqual(parseMarkdown("\r\n\r\n"), []);
  assert.deepEqual(parseMarkdown(undefined as unknown as string), []);
});
