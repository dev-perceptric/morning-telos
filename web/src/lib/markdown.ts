// The Markdown the team writes in replies: paragraphs and line breaks, ## to #### headings, - and 1. lists (one level
// of nesting, numbers kept), > quotes, --- rules, ``` code, GFM tables, and inline **bold**, *italic*, `code` and links.
// Started from the old app's md() (app/public/app.js). Pure and returns data, never HTML, so nothing in a reply can
// run as HTML on the screen. Links are kept only when they go to http or https. Chat.tsx draws the blocks and
// src/app/mt.css styles them under .md.

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "italic"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string };

/** One list item, and the list under it when the item has one (one level only). */
export type ListItem = { parts: Inline[]; sub?: List };
export type List = { kind: "ul"; items: ListItem[] } | { kind: "ol"; start: number; items: ListItem[] };
/** left, center or right. A numeric column with no alignment of its own is right-aligned. */
export type Align = "left" | "center" | "right";
export type Table = { kind: "table"; head: Inline[][]; align: Align[]; numeric: boolean[]; rows: Inline[][][] };

export type Block =
  | { kind: "p"; lines: Inline[][] }
  /** # and ## are level 2, ### is 3, #### and smaller are 4. */
  | { kind: "h"; level: 2 | 3 | 4; parts: Inline[] }
  | List
  | { kind: "quote"; blocks: Block[] }
  | { kind: "hr" }
  | { kind: "code"; text: string }
  | Table;

/** The most columns and body rows a table keeps. More is cut, so one reply can't make a huge page. */
export const MAX_COLS = 12;
export const MAX_ROWS = 200;

/** A link's address, only when it is a plain web address. Anything else (javascript:, data:...) is dropped. */
export function safeHref(href: string): string | null {
  try {
    const u = new URL(href);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

// **bold**, `code`, [text](https://...), bare https://... addresses, *italic* and _italic_, in the order they appear.
const INLINE =
  /\*\*([^*\n]+?)\*\*|`([^`\n]+)`|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"|])|\*([^*\s](?:[^*\n]*[^*\s])?)\*|(?<![\w])_([^_\s](?:[^_\n]*[^_\s])?)_(?![\w])/g;

/** One line's pieces. Plain text stays text. */
export function inlineMd(line: string): Inline[] {
  const out: Inline[] = [];
  let at = 0;
  const text = (t: string) => {
    if (!t) return;
    const last = out[out.length - 1];
    if (last?.kind === "text") last.text += t;
    else out.push({ kind: "text", text: t });
  };
  for (const m of line.matchAll(INLINE)) {
    text(line.slice(at, m.index));
    at = m.index! + m[0].length;
    if (m[1] !== undefined) out.push({ kind: "bold", text: m[1] });
    else if (m[2] !== undefined) out.push({ kind: "code", text: m[2] });
    else if (m[6] !== undefined || m[7] !== undefined) out.push({ kind: "italic", text: (m[6] ?? m[7])! });
    else {
      const href = safeHref(m[4] ?? m[5]);
      if (href) out.push({ kind: "link", text: m[3] ?? m[5], href });
      else text(m[0]);
    }
  }
  text(line.slice(at));
  return out;
}

/** The words of some pieces, without their marks. */
export const plainText = (parts: Inline[]) => parts.map((p) => p.text).join("");

// ─────────────── tables ───────────────

/** A table row's cells: the outer pipes dropped, split on | that isn't escaped (\|) or inside `code`. */
export function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  let code = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && s[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (c === "`") {
      code = !code;
      cur += c;
    } else if (c === "|" && !code) {
      cells.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

const DELIM_CELL = /^:?-+:?$/;
/** The |---|:---:|---:| line under a table's header, as each column's alignment (null when it says none). */
export function delimiterRow(line: string): (Align | null)[] | null {
  if (!line.includes("-") || !/^[\s|:-]+$/.test(line)) return null;
  const cells = splitRow(line);
  if (!cells.length || !cells.every((c) => DELIM_CELL.test(c))) return null;
  // A line of dashes alone is a rule, not a table, unless it has a pipe.
  if (!line.includes("|") && cells.length < 2) return null;
  return cells.map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : c.startsWith(":") ? "left" : null));
}

// 1,240 · $45 · -3% · +22% · 4.5 · 12k · $1.2M · 3x · (120) · 1 240. A dash alone is "no value" and doesn't count.
const NUMBER = /^[(]?[+\-\u2212]?[$€£¥]?\s?\d[\d,.\s]*\s?(%|[kmb]|x|k\/mo)?[)]?$/i;
/** True when the text reads as one number: an amount, a percent, a count. */
export const isNumber = (s: string) => NUMBER.test(s.trim());
const EMPTYISH = /^(|-|\u2013|\u2014|n\/a|na)$/i;

/** A column is numeric when it has at least one number and every other cell is a number or empty. */
export function numericColumn(cells: string[]): boolean {
  const filled = cells.map((c) => c.trim()).filter((c) => !EMPTYISH.test(c));
  return filled.length > 0 && filled.every(isNumber);
}

function makeTable(headLine: string, align: (Align | null)[], body: string[]): Table {
  const head = splitRow(headLine).slice(0, MAX_COLS);
  const n = head.length;
  const raw = body.slice(0, MAX_ROWS).map((r) => {
    const cells = splitRow(r).slice(0, n);
    while (cells.length < n) cells.push("");
    return cells;
  });
  const rows = raw.map((r) => r.map(inlineMd));
  const numeric = head.map((_, i) => numericColumn(rows.map((r) => plainText(r[i]))));
  return {
    kind: "table",
    head: head.map(inlineMd),
    align: head.map((_, i) => align[i] ?? (numeric[i] ? "right" : "left")),
    numeric,
    rows,
  };
}

// ─────────────── blocks ───────────────

const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const BULLET = /^(\s*)[-*+•]\s+(.*)$/;
const NUMBERED = /^(\s*)(\d{1,4})[.)]\s+(.*)$/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*)$/;
const QUOTE = /^ {0,3}>\s?(.*)$/;
const FENCE = /^ {0,3}(```|~~~)/;

/** How far a line is indented, with a tab as 4 spaces. */
const indentOf = (s: string) => s.replace(/\t/g, "    ").length;

type ListLine = { indent: number; kind: "ul" | "ol"; n: number; text: string };
function listLine(line: string): ListLine | null {
  let m = line.match(BULLET);
  if (m && !RULE.test(line)) return { indent: indentOf(m[1]), kind: "ul", n: 0, text: m[2] };
  m = line.match(NUMBERED);
  if (m) return { indent: indentOf(m[1]), kind: "ol", n: Number(m[2]), text: m[3] };
  return null;
}

type Draft = { kind: "ul" | "ol"; start: number; items: { text: string; sub: Draft | null }[] };
const finish = (d: Draft): List => {
  const items = d.items.map((it) => ({ parts: inlineMd(it.text), ...(it.sub ? { sub: finish(it.sub) } : {}) }));
  return d.kind === "ul" ? { kind: "ul", items } : { kind: "ol", start: d.start, items };
};

/** A reply as blocks. `depth` stops quotes inside quotes from going on forever. */
export function parseMarkdown(src: string, depth = 0): Block[] {
  const lines = String(src ?? "").replace(/\r\n?/g, "\n").split("\n");
  const out: Block[] = [];
  let para: string[] = [];
  let list: Draft | null = null;
  // The indent of the top list's items, so a deeper item goes under the one above it.
  let listIndent = 0;
  // A blank line inside a list: the list goes on if the next line is another item.
  let gap = false;

  const flushPara = () => {
    if (para.length) out.push({ kind: "p", lines: para.map(inlineMd) });
    para = [];
  };
  const flushList = () => {
    if (list) out.push(finish(list));
    list = null;
    gap = false;
  };
  const flush = () => {
    flushPara();
    flushList();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();

    if (!line.trim()) {
      flushPara();
      if (list) gap = true;
      continue;
    }

    // ``` code, kept as it is until the closing fence.
    const fence = line.match(FENCE);
    if (fence) {
      flush();
      const body: string[] = [];
      for (i++; i < lines.length && !lines[i].trimStart().startsWith(fence[1]); i++) body.push(lines[i]);
      out.push({ kind: "code", text: body.join("\n") });
      continue;
    }

    // A table: a row with a pipe, then the |---| line. Its body runs to the first line without a pipe.
    const align = line.includes("|") && i + 1 < lines.length ? delimiterRow(lines[i + 1].trim()) : null;
    if (align && splitRow(line).length === align.length) {
      flush();
      const body: string[] = [];
      for (i += 2; i < lines.length && lines[i].trim() && lines[i].includes("|"); i++) body.push(lines[i]);
      i--;
      out.push(makeTable(line, align, body));
      continue;
    }

    if (RULE.test(line)) {
      flush();
      out.push({ kind: "hr" });
      continue;
    }

    let m = line.match(HEADING);
    if (m) {
      flush();
      const n = m[1].length;
      out.push({ kind: "h", level: n <= 2 ? 2 : n === 3 ? 3 : 4, parts: inlineMd(m[2].replace(/\s+#+$/, "")) });
      continue;
    }

    m = line.match(QUOTE);
    if (m) {
      flush();
      const body = [m[1]];
      for (i++; i < lines.length && QUOTE.test(lines[i]); i++) body.push(lines[i].match(QUOTE)![1]);
      i--;
      const inner = depth < 1 ? parseMarkdown(body.join("\n"), depth + 1) : [{ kind: "p" as const, lines: body.filter((b) => b.trim()).map(inlineMd) }];
      if (inner.length) out.push({ kind: "quote", blocks: inner });
      continue;
    }

    const item = listLine(line);
    if (item) {
      flushPara();
      const current = list as Draft | null;
      const last = current?.items[current.items.length - 1];
      if (current && last && item.indent >= listIndent + 2) {
        // A deeper item goes under the item above. Anything deeper than one level stays at that level.
        if (!last.sub || last.sub.kind !== item.kind) last.sub = { kind: item.kind, start: item.n || 1, items: [] };
        last.sub.items.push({ text: item.text, sub: null });
      } else if (current && current.kind === item.kind) {
        current.items.push({ text: item.text, sub: null });
      } else {
        flushList();
        list = { kind: item.kind, start: item.n || 1, items: [{ text: item.text, sub: null }] };
        listIndent = item.indent;
      }
      gap = false;
      continue;
    }

    if (list && !gap && /^\s{2,}\S/.test(line)) {
      // A wrapped list item: the indented line belongs to the item above (or the sub item above).
      const top = (list as Draft).items[(list as Draft).items.length - 1];
      const target = top.sub ? top.sub.items[top.sub.items.length - 1] : top;
      target.text += ` ${line.trim()}`;
      continue;
    }

    flushList();
    para.push(line);
  }
  flush();
  return out;
}

// ─────────────── a reply as it streams ───────────────

/** A line that is only a mark so far: "-", "1.", "##", ">", "|", "`". It shows once words follow. */
const BARE_MARK = /^\s*([-*+>#]+|\d+[.)]?|`{1,3}|\|[\s|:-]*)\s*$/;

/**
 * A reply that is still being written, made safe to draw: a half-written line or table row waits until it is
 * whole, a table header waits for its |---| line (so it never shows as a line of pipes first), an open **bold**
 * or `code` is closed, and a half-written link shows only its words. Drawing the result with parseMarkdown never
 * jumps between layouts as more text arrives. Pure.
 */
export function partialMarkdown(src: string): string {
  const text = String(src ?? "").replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  // The last line is still being written unless the text ends with a line break.
  const open = lines.length > 0 && !text.endsWith("\n");
  if (open) {
    const last = lines[lines.length - 1];
    if (last.trimStart().startsWith("|") || BARE_MARK.test(last)) lines.pop();
  }
  // Drop the empty line a trailing break leaves, so the checks below see the last real line.
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();

  // A table being written: the pipe lines at the end. A header alone waits for its |---| line.
  let start = lines.length;
  while (start > 0 && lines[start - 1].trimStart().startsWith("|")) start--;
  const block = lines.slice(start);
  if (block.length === 1) lines.pop();
  // A |---| line that isn't whole yet (too few columns): the table waits for it.
  else if (block.length >= 2 && !delimiterRow(block[1].trim()) && /^\s*\|[\s|:-]*$/.test(block[1])) lines.splice(start);

  // Inside the last line: close an open **bold** and `code`, and show a half-written link as its words.
  if (open && lines.length) {
    let last = lines[lines.length - 1];
    // A ``` fence is a code block, which parseMarkdown already draws open to the end.
    if (!/^\s*```/.test(last)) {
      last = last.replace(/\[([^\]\n]*)(\]\([^)\s]*)?$/, "$1");
      if ((last.match(/\*\*/g) ?? []).length % 2) last = /\*\*$/.test(last) ? last.slice(0, -2) : `${last}**`;
      if ((last.match(/`/g) ?? []).length % 2) last = /`$/.test(last) ? last.slice(0, -1) : `${last}\``;
    }
    lines[lines.length - 1] = last;
  }
  return lines.join("\n");
}
