// The small piece of Markdown the team writes in replies: paragraphs and line breaks, - and 1. lists, # headings,
// **bold**, `code` and links. Ported from the old app's md() (app/public/app.js). Pure and returns data, never HTML,
// so nothing in a reply can run as HTML on the screen. Links are kept only when they go to http or https.

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string };

export type Block =
  | { kind: "p"; lines: Inline[][] }
  | { kind: "h"; parts: Inline[] }
  | { kind: "ul"; items: Inline[][] }
  | { kind: "ol"; start: number; items: Inline[][] };

/** A link's address, only when it is a plain web address. Anything else (javascript:, data:...) is dropped. */
export function safeHref(href: string): string | null {
  try {
    const u = new URL(href);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

// **bold**, `code`, [text](https://...) and bare https://... addresses, in the order they appear.
const INLINE = /\*\*([^*\n]+?)\*\*|`([^`\n]+)`|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;

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
    else {
      const href = safeHref(m[4] ?? m[5]);
      if (href) out.push({ kind: "link", text: m[3] ?? m[5], href });
      else text(m[0]);
    }
  }
  text(line.slice(at));
  return out;
}

/** A reply as blocks: paragraphs (their lines kept), headings and lists. */
export function parseMarkdown(src: string): Block[] {
  const out: Block[] = [];
  let para: string[] = [];
  let list: { kind: "ul" | "ol"; start: number; items: string[] } | null = null;
  const flushPara = () => {
    if (para.length) out.push({ kind: "p", lines: para.map(inlineMd) });
    para = [];
  };
  const flushList = () => {
    if (list) out.push(list.kind === "ul" ? { kind: "ul", items: list.items.map(inlineMd) } : { kind: "ol", start: list.start, items: list.items.map(inlineMd) });
    list = null;
  };
  for (const raw of String(src ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^\s*[-*•]\s+(.*)$/))) {
      flushPara();
      if (list?.kind !== "ul") {
        flushList();
        list = { kind: "ul", start: 1, items: [] };
      }
      list.items.push(m[1]);
    } else if ((m = line.match(/^\s*(\d{1,4})[.)]\s+(.*)$/))) {
      flushPara();
      if (list?.kind !== "ol") {
        flushList();
        list = { kind: "ol", start: Number(m[1]) || 1, items: [] };
      }
      list.items.push(m[2]);
    } else if ((m = line.match(/^#{1,6}\s+(.*)$/))) {
      flushPara();
      flushList();
      out.push({ kind: "h", parts: inlineMd(m[1].replace(/\s*#+$/, "")) });
    } else if (!line.trim()) {
      flushPara();
      flushList();
    } else if (list && /^\s{2,}\S/.test(line)) {
      // A wrapped list item: the indented line belongs to the item above.
      list.items[list.items.length - 1] += ` ${line.trim()}`;
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return out;
}
