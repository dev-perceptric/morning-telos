import assert from "node:assert/strict";
import test from "node:test";
import { delimiterRow, inlineMd, isNumber, numericColumn, parseMarkdown, partialMarkdown, plainText, safeHref, splitRow, MAX_COLS, MAX_ROWS, type Block, type Table } from "../src/lib/markdown.ts";

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
    { kind: "ul", items: [{ parts: [{ kind: "bold", text: "Where you stand:" }, { kind: "text", text: " how often" }] }, { parts: [{ kind: "text", text: "Who wins" }] }] },
    { kind: "ol", start: 1, items: [{ parts: [{ kind: "text", text: "Your basics" }] }, { parts: [{ kind: "text", text: "The questions" }] }] },
  ]);
});

test("parseMarkdown: a list right after a line, a list that starts at 3, and headings", () => {
  const blocks = parseMarkdown("Steps:\n3. Third\n4. Fourth\n## Next up\n* star item");
  assert.equal(blocks[0].kind, "p");
  assert.deepEqual(blocks[1], { kind: "ol", start: 3, items: [{ parts: [{ kind: "text", text: "Third" }] }, { parts: [{ kind: "text", text: "Fourth" }] }] });
  assert.deepEqual(blocks[2], { kind: "h", level: 2, parts: [{ kind: "text", text: "Next up" }] });
  assert.deepEqual(blocks[3], { kind: "ul", items: [{ parts: [{ kind: "text", text: "star item" }] }] });
});

test("parseMarkdown: an indented line continues the list item above", () => {
  assert.deepEqual(parseMarkdown("- one\n  more of one\n- two"), [{ kind: "ul", items: [{ parts: [{ kind: "text", text: "one more of one" }] }, { parts: [{ kind: "text", text: "two" }] }] }]);
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

// ─────────────── tables and the newer blocks ───────────────

const T = (text: string) => [{ kind: "text" as const, text }];

test("tables: header, body rows and alignment from :---:, ---: and :---", () => {
  const [t] = parseMarkdown("| Month | Traffic | Note | Where |\n|:---|---:|:---:|---|\n| Jan | 860 | ok | Google |\n| Feb | 1,050 | up | Bing |");
  assert.deepEqual(t, {
    kind: "table",
    head: [T("Month"), T("Traffic"), T("Note"), T("Where")],
    align: ["left", "right", "center", "left"],
    numeric: [false, true, false, false],
    rows: [
      [T("Jan"), T("860"), T("ok"), T("Google")],
      [T("Feb"), T("1,050"), T("up"), T("Bing")],
    ],
  });
});

test("tables: the Theseus answer that showed raw pipes now parses, numbers right-aligned on their own", () => {
  const blocks = parseMarkdown("Here is your traffic:\n| Month | Traffic |\n|---|---|\n| March | 1,240 |\n| April | -3% |\n| May | - |\nThat's all.");
  assert.deepEqual(blocks.map((b) => b.kind), ["p", "table", "p"]);
  const t = blocks[1] as Extract<Block, { kind: "table" }>;
  assert.deepEqual(t.align, ["left", "right"]);
  assert.deepEqual(t.numeric, [false, true]);
  assert.equal(t.rows.length, 3);
});

test("tables: inline formatting in cells, escaped pipes, pipes in code, short and long rows", () => {
  const [t] = parseMarkdown("Page | Link\n--- | ---\n**Cakes** | [see](https://a.com/c)\n`a|b` | x \\| y\n| only one\n| 1 | 2 | 3 |") as Extract<Block, { kind: "table" }>[];
  assert.deepEqual(t.rows[0], [[{ kind: "bold", text: "Cakes" }], [{ kind: "link", text: "see", href: "https://a.com/c" }]]);
  assert.deepEqual(t.rows[1], [[{ kind: "code", text: "a|b" }], T("x | y")]);
  assert.deepEqual(t.rows[2], [T("only one"), []]);
  assert.deepEqual(t.rows[3], [T("1"), T("2")]);
});

test("tables: a header with the wrong number of cells is a paragraph; a blank line ends the table", () => {
  assert.equal(parseMarkdown("| a | b |\n|---|\n| 1 | 2 |")[0].kind, "p");
  assert.deepEqual(parseMarkdown("| a |\n|---|\n| 1 |\n\n| 2 |").map((b) => b.kind), ["table", "p"]);
});

test("tables: at most MAX_COLS columns and MAX_ROWS rows", () => {
  const head = `|${Array.from({ length: 20 }, (_, i) => ` c${i} `).join("|")}|`;
  const delim = `|${Array.from({ length: 20 }, () => "---").join("|")}|`;
  const rows = Array.from({ length: 300 }, () => `|${Array.from({ length: 20 }, () => " 1 ").join("|")}|`);
  const [t] = parseMarkdown([head, delim, ...rows].join("\n")) as Extract<Block, { kind: "table" }>[];
  assert.equal(t.head.length, MAX_COLS);
  assert.equal(t.rows.length, MAX_ROWS);
});

test("splitRow and delimiterRow", () => {
  assert.deepEqual(splitRow("| a | b |"), ["a", "b"]);
  assert.deepEqual(splitRow("a|b"), ["a", "b"]);
  assert.deepEqual(splitRow("| `x|y` | z\\|w |"), ["`x|y`", "z|w"]);
  assert.deepEqual(delimiterRow("|:--|--:|:-:|---|"), ["left", "right", "center", null]);
  assert.deepEqual(delimiterRow("--- | ---"), [null, null]);
  assert.equal(delimiterRow("---"), null);
  assert.equal(delimiterRow("| a | b |"), null);
});

test("isNumber and numericColumn", () => {
  for (const n of ["1,240", "$45", "-3%", "+22%", "4.5", "12k", "$1.2M", "3x", "(120)", "€9.99", "1 240", "\u22125"]) assert.ok(isNumber(n), n);
  for (const n of ["March", "about 5", "5 visits", "", "v2 launch"]) assert.ok(!isNumber(n), n);
  assert.ok(numericColumn(["1", "", "-", "n/a", "2%"]));
  assert.ok(!numericColumn(["1", "two"]));
  assert.ok(!numericColumn(["", "-"]));
});

test("headings step down: # and ## are 2, ### is 3, #### and smaller are 4; trailing #s go", () => {
  assert.deepEqual(
    parseMarkdown("# One\n## Two\n### Three ###\n#### Four\n###### Six").map((b) => (b.kind === "h" ? [b.level, plainText(b.parts)] : null)),
    [
      [2, "One"],
      [2, "Two"],
      [3, "Three"],
      [4, "Four"],
      [4, "Six"],
    ],
  );
  assert.equal(parseMarkdown("#hashtag")[0].kind, "p");
});

test("blockquotes hold their own blocks; rules split blocks; --- is not a list", () => {
  const blocks = parseMarkdown("> **Tip:** post at 9am.\n> - short\n> - clear\n\n---\n* * *\nAfter");
  assert.deepEqual(blocks.map((b) => b.kind), ["quote", "hr", "hr", "p"]);
  const q = blocks[0] as Extract<Block, { kind: "quote" }>;
  assert.deepEqual(q.blocks.map((b) => b.kind), ["p", "ul"]);
  // A quote inside a quote stays text, so nothing nests forever.
  const deep = parseMarkdown("> > > deep")[0] as Extract<Block, { kind: "quote" }>;
  assert.equal(deep.blocks[0].kind, "quote");
  assert.equal(((deep.blocks[0] as Extract<Block, { kind: "quote" }>).blocks[0] as Extract<Block, { kind: "p" }>).kind, "p");
});

test("nested lists go one level deep, under the item above; deeper ones stay at that level", () => {
  const [l] = parseMarkdown("- Cakes\n  - Wedding\n    - Tiered\n  1. First\n- Bread") as Extract<Block, { kind: "ul" }>[];
  assert.equal(l.items.length, 2);
  assert.deepEqual(l.items[0].sub, { kind: "ol", start: 1, items: [{ parts: T("First") }] });
  assert.deepEqual(l.items[1], { parts: T("Bread") });
  const [m] = parseMarkdown("1. Plan\n   - write\n   - post\n2. Check") as Extract<Block, { kind: "ol" }>[];
  assert.deepEqual(m.items[0].sub, { kind: "ul", items: [{ parts: T("write") }, { parts: T("post") }] });
});

test("numbered lists keep their numbers, also with blank lines between items", () => {
  const blocks = parseMarkdown("1. One\n\n2. Two\n\nA note.\n\n3. Three\n4. Four");
  assert.deepEqual(blocks.map((b) => (b.kind === "ol" ? [b.start, b.items.length] : b.kind)), [[1, 2], "p", [3, 2]]);
});

test("italic with * and _, next to bold, and not inside words or lists", () => {
  assert.deepEqual(inlineMd("A *quick* and **bold** _note_."), [
    { kind: "text", text: "A " },
    { kind: "italic", text: "quick" },
    { kind: "text", text: " and " },
    { kind: "bold", text: "bold" },
    { kind: "text", text: " " },
    { kind: "italic", text: "note" },
    { kind: "text", text: "." },
  ]);
  assert.deepEqual(inlineMd("snake_case_name and 2 * 3 * 4"), [{ kind: "text", text: "snake_case_name and 2 * 3 * 4" }]);
  assert.equal(parseMarkdown("* item")[0].kind, "ul");
});

test("fenced code is kept as it is", () => {
  assert.deepEqual(parseMarkdown("```\n| a | b |\n**not bold**\n```\nafter"), [
    { kind: "code", text: "| a | b |\n**not bold**" },
    { kind: "p", lines: [T("after")] },
  ]);
});

// ─────────────── a reply as it streams ───────────────

const RICH = `Your traffic is up **12%** this month.

### What changed

- More people found the **menu page**
- Two new keywords: \`sourdough\` and [rye bread](https://anasbakery.com/rye)
  - Both from Google

| Month | Visits | Change |
|:------|-------:|:------:|
| Sep | 1,240 | +4% |
| Oct | 1,390 | +12% |

> Keep posting weekly.

\`\`\`
code here
\`\`\`

1. Add a page
2. Ask Theseus again

---
End.`;

test("partialMarkdown: every prefix of a long reply parses without throwing", () => {
  for (let i = 0; i <= RICH.length; i++) {
    const part = RICH.slice(0, i);
    assert.doesNotThrow(() => parseMarkdown(partialMarkdown(part)), `at ${i}`);
  }
  // A whole reply comes through as it was, apart from the last line break.
  assert.equal(partialMarkdown(`${RICH}\n`), RICH);
});

test("partialMarkdown: a table header waits for its |---| line, and a half row waits until it is whole", () => {
  const head = "Here are the numbers.\n\n| Month | Visits |\n";
  assert.deepEqual(parseMarkdown(partialMarkdown(head)).map((b) => b.kind), ["p"]);
  assert.doesNotMatch(JSON.stringify(parseMarkdown(partialMarkdown(head))), /Month/);
  assert.deepEqual(parseMarkdown(partialMarkdown(`${head}|---|-`)).map((b) => b.kind), ["p"]);
  const rows = `${head}|---|---|\n| Sep | 1,240 |\n| Oct | 1,3`;
  const blocks = parseMarkdown(partialMarkdown(rows));
  assert.deepEqual(blocks.map((b) => b.kind), ["p", "table"]);
  const t = blocks[1] as Table;
  assert.equal(t.rows.length, 1, "the half-written row isn't drawn yet");
  // Every prefix of a table is either text above it or a table: never a line of pipes.
  const full = `${head}|---|---|\n| Sep | 1,240 |\n| Oct | 1,390 |\n`;
  for (let i = head.length - 20; i <= full.length; i++) {
    const kinds = parseMarkdown(partialMarkdown(full.slice(0, i)));
    assert.ok(!JSON.stringify(kinds).includes("| Month"), `pipes shown at ${i}`);
  }
});

test("partialMarkdown: open bold and code are closed, a half link shows its words, a bare mark waits", () => {
  assert.equal(partialMarkdown("Visits are **1,24"), "Visits are **1,24**");
  assert.equal(partialMarkdown("Visits are **"), "Visits are ");
  assert.equal(partialMarkdown("Run `npm te"), "Run `npm te`");
  assert.equal(partialMarkdown("See [the menu](https://anas"), "See the menu");
  assert.equal(partialMarkdown("See [the me"), "See the me");
  assert.equal(partialMarkdown("Steps:\n1."), "Steps:");
  assert.equal(partialMarkdown("Steps:\n-"), "Steps:");
  assert.equal(partialMarkdown("Intro\n##"), "Intro");
  assert.equal(partialMarkdown(""), "");
  // A finished line keeps its marks as written.
  assert.equal(partialMarkdown("Visits are **1,240**\n"), "Visits are **1,240**");
});

test("partialMarkdown: an open code block stays a code block while it is written", () => {
  const blocks = parseMarkdown(partialMarkdown("Try this:\n\n```\nconst a = `x"));
  assert.deepEqual(blocks.map((b) => b.kind), ["p", "code"]);
});
