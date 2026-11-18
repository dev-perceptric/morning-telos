// The look every Morning Telos email shares, copied from Arrowsterr's emailKit and given the look of the old app's
// emails (app/lib/email.js layout): a warm off-white page, the "Morning Telos" wordmark, a Georgia serif title and a
// black button. Emails are built from blocks, so each one gets an HTML body and a plain-text copy from the same data.
// Pure, so tests can check every email.
//
// Email clients are old: tables for layout and styles inline.

export type Link = { label: string; url: string };

export type Block = { t: "p"; text: string } | { t: "small"; text: string } | { t: "code"; label: string; code: string } | { t: "list"; items: string[] };

export type EmailParts = {
  subject: string;
  /** The line inboxes show after the subject. */
  preview: string;
  title: string;
  blocks: Block[];
  button?: Link;
  /** A quieter text link under the button. */
  link?: Link;
  /** Blocks under the button, like a sign-in code. */
  after?: Block[];
  /** Show the button's link as text too, for clients that block buttons. On unless false. */
  paste?: boolean;
  /** Why the person gets this email, and links like Unsubscribe. */
  footer: { text: string; links?: Link[] };
};

export type Email = { subject: string; preview: string; html: string; text: string };

export const appUrl = () => (typeof process !== "undefined" ? process.env.APP_URL?.trim().replace(/\/+$/, "") : "") || "https://chat.morningtelos.com";

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
const safeUrl = (u: string) => (/^(https?:|mailto:)/i.test(u) ? u : "#");

// The old app's colors (app/lib/email.js).
const C = { page: "#faf9f5", ink: "#141413", body: "#3a3a37", quiet: "#65645f", faint: "#8c8b84", line: "#e8e6dc", box: "#ffffff" };
const SANS = "Helvetica,Arial,sans-serif";
const SERIF = "Georgia,'Times New Roman',serif";

function blockHtml(b: Block): string {
  switch (b.t) {
    case "p":
      return `<tr><td style="font-family:${SANS};font-size:16px;line-height:25px;color:${C.body};padding:0 0 14px">${esc(b.text)}</td></tr>`;
    case "small":
      return `<tr><td style="font-family:${SANS};font-size:14px;line-height:22px;color:${C.quiet};padding:18px 0 0">${esc(b.text)}</td></tr>`;
    case "code":
      return `<tr><td style="padding:22px 0 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="background:${C.box};border:1px solid ${C.line};border-radius:10px;padding:16px">
<div style="font-family:${SANS};font-size:13px;line-height:18px;color:${C.quiet};padding-bottom:6px">${esc(b.label)}</div>
<div style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:30px;line-height:36px;font-weight:600;letter-spacing:0.3em;padding-left:0.3em;color:${C.ink}">${esc(b.code)}</div></td></tr></table></td></tr>`;
    case "list":
      return `<tr><td style="padding:0 0 14px"><table role="presentation" cellpadding="0" cellspacing="0">${b.items
        .map((i) => `<tr><td valign="top" style="font-family:${SANS};font-size:16px;line-height:25px;color:${C.body};padding:0 10px 4px 0">&bull;</td><td style="font-family:${SANS};font-size:16px;line-height:25px;color:${C.body};padding:0 0 4px">${esc(i)}</td></tr>`)
        .join("")}</table></td></tr>`;
  }
}

function blockText(b: Block): string[] {
  switch (b.t) {
    case "p":
    case "small":
      return [b.text, ""];
    case "code":
      return [`${b.label}: ${b.code}`, ""];
    case "list":
      return [...b.items.map((i) => `- ${i}`), ""];
  }
}

/** One email from its parts: subject, preview line, HTML body and plain-text copy. */
export function renderEmail(e: EmailParts): Email {
  const subject = oneLine(e.subject).slice(0, 200);
  const preview = oneLine(e.preview).slice(0, 200);
  const btn = e.button
    ? `<tr><td style="padding:8px 0 0"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:${C.ink};border-radius:10px"><a href="${esc(safeUrl(e.button.url))}" style="display:inline-block;background:${C.ink};color:#ffffff;text-decoration:none;font-family:${SANS};font-weight:600;font-size:15px;line-height:20px;padding:12px 20px;border-radius:10px">${esc(e.button.label)}</a></td></tr></table></td></tr>`
    : "";
  const link = e.link
    ? `<tr><td style="font-family:${SANS};font-size:14px;line-height:22px;padding:14px 0 0"><a href="${esc(safeUrl(e.link.url))}" style="color:${C.quiet};text-decoration:underline">${esc(e.link.label)}</a></td></tr>`
    : "";
  const paste = e.button && e.paste !== false
    ?`<tr><td style="font-family:${SANS};font-size:12px;line-height:18px;color:${C.faint};padding:28px 0 0;word-break:break-all">Or paste this link: ${esc(safeUrl(e.button.url))}</td></tr>`
    : "";
  const footLinks = (e.footer.links ?? []).map((l) => `&nbsp; <a href="${esc(safeUrl(l.url))}" style="color:${C.faint};text-decoration:underline">${esc(l.label)}</a>`).join("");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${C.page};font-family:${SANS};color:${C.ink};-webkit-font-smoothing:antialiased">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${esc(preview)}${"&#8199;&#65279;&#847; ".repeat(30)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page}"><tr><td align="center" style="padding:36px 24px">
<table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%">
<tr><td style="font-family:${SANS};font-size:15px;line-height:20px;font-weight:600;color:${C.ink};padding:0 0 28px">Morning Telos</td></tr>
<tr><td style="font-family:${SERIF};font-weight:400;font-size:28px;line-height:34px;color:${C.ink};padding:0 0 14px">${esc(e.title)}</td></tr>
${e.blocks.map(blockHtml).join("\n")}
${btn}${link}${(e.after ?? []).map(blockHtml).join("\n")}${paste}
<tr><td style="padding:28px 0 0;font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td style="font-family:${SANS};font-size:12px;line-height:18px;color:${C.faint};padding:20px 0 0;border-top:1px solid ${C.line}">${esc(e.footer.text)}${footLinks}</td></tr>
<tr><td style="font-family:${SANS};font-size:12px;line-height:18px;color:${C.faint};padding:8px 0 0">Morning Telos, an AI team for small businesses.&nbsp; <a href="https://morningtelos.com/privacy" style="color:${C.faint};text-decoration:underline">Privacy</a></td></tr>
</table></td></tr></table></body></html>`;

  const lines = [
    "Morning Telos",
    "",
    e.title,
    "",
    ...e.blocks.flatMap(blockText),
    ...(e.button ? [`${e.button.label}: ${e.button.url}`, ""] : []),
    ...(e.link ? [`${e.link.label}: ${e.link.url}`, ""] : []),
    ...(e.after ?? []).flatMap(blockText),
    "--",
    e.footer.text,
    ...(e.footer.links ?? []).map((l) => `${l.label}: ${l.url}`),
  ];
  const text = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { subject, preview, html, text };
}
