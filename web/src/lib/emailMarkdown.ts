// A teammate's Markdown answer as simple email HTML: paragraphs, headings, lists, quotes, code and tables, with
// styles inline because email clients drop style sheets. Built from the same parser the chat uses
// (src/lib/markdown.ts), so an answer reads the same in both. Everything is escaped and links are http or https only.
// Pure.
import { parseMarkdown, type Align, type Block, type Inline, type List } from "./markdown.ts";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// The same colors and fonts as the email kit (src/lib/emailKit.ts).
const C = { ink: "#141413", body: "#3a3a37", quiet: "#65645f", line: "#e8e6dc", box: "#f4f2ea" };
const SANS = "Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,Menlo,Consolas,monospace";
const TEXT = `font-family:${SANS};font-size:16px;line-height:25px;color:${C.body}`;

function inline(parts: Inline[]): string {
  return parts
    .map((p) => {
      switch (p.kind) {
        case "bold":
          return `<strong style="color:${C.ink}">${esc(p.text)}</strong>`;
        case "italic":
          return `<em>${esc(p.text)}</em>`;
        case "code":
          return `<code style="font-family:${MONO};font-size:14px;background:${C.box};border-radius:4px;padding:1px 4px">${esc(p.text)}</code>`;
        case "link":
          return `<a href="${esc(p.href)}" style="color:${C.ink};text-decoration:underline">${esc(p.text)}</a>`;
        default:
          return esc(p.text);
      }
    })
    .join("");
}

function list(l: List): string {
  const tag = l.kind === "ol" ? "ol" : "ul";
  const start = l.kind === "ol" && l.start !== 1 ? ` start="${l.start}"` : "";
  const items = l.items.map((i) => `<li style="margin:0 0 4px">${inline(i.parts)}${i.sub ? list(i.sub) : ""}</li>`).join("");
  return `<${tag}${start} style="${TEXT};margin:0 0 14px;padding:0 0 0 22px">${items}</${tag}>`;
}

const ALIGN: Record<Align, string> = { left: "left", center: "center", right: "right" };

function block(b: Block): string {
  switch (b.kind) {
    case "p":
      return `<p style="${TEXT};margin:0 0 14px">${b.lines.map(inline).join("<br>")}</p>`;
    case "h": {
      const size = b.level === 2 ? 20 : b.level === 3 ? 17 : 16;
      return `<p style="font-family:${SANS};font-size:${size}px;line-height:1.35;font-weight:600;color:${C.ink};margin:18px 0 8px">${inline(b.parts)}</p>`;
    }
    case "ul":
    case "ol":
      return list(b);
    case "quote":
      return `<div style="border-left:3px solid ${C.line};padding:0 0 0 12px;margin:0 0 14px;color:${C.quiet}">${b.blocks.map(block).join("")}</div>`;
    case "hr":
      return `<hr style="border:0;border-top:1px solid ${C.line};margin:18px 0">`;
    case "code":
      return `<pre style="font-family:${MONO};font-size:13px;line-height:19px;background:${C.box};border-radius:8px;padding:12px;margin:0 0 14px;white-space:pre-wrap;word-break:break-word">${esc(b.text)}</pre>`;
    case "table": {
      const cell = (tag: "th" | "td", parts: Inline[], i: number) => {
        const align = b.align[i] ?? (b.numeric[i] ? "right" : "left");
        const weight = tag === "th" ? "font-weight:600;color:" + C.ink + ";" : "";
        return `<${tag} align="${ALIGN[align]}" style="font-family:${SANS};font-size:14px;line-height:20px;${weight}padding:6px 10px;border-bottom:1px solid ${C.line};text-align:${ALIGN[align]}">${inline(parts)}</${tag}>`;
      };
      const head = `<tr>${b.head.map((h, i) => cell("th", h, i)).join("")}</tr>`;
      const rows = b.rows.map((r) => `<tr>${r.map((c, i) => cell("td", c, i)).join("")}</tr>`).join("");
      return `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 14px;color:${C.body}">${head}${rows}</table>`;
    }
  }
}

/** The answer as email HTML. */
export function markdownHtml(src: string): string {
  return parseMarkdown(src).map(block).join("\n");
}

/** The answer as plain text for the email's text copy. Markdown already reads well as text, so little changes. */
export function markdownText(src: string): string {
  return String(src ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
