// The words of a received email, ready to save as the person's message: the plain text (or the HTML turned into
// text), without the older emails it quotes and without the signature. A forward keeps the forwarded email, since
// that is what the person wants the team to read. Pure, so tests check every rule.
import { capText, cleanText } from "./pageContext.ts";

/** Most characters of an email kept as the message, the same as a chat message (src/lib/chat.ts MAX_MESSAGE). */
export const EMAIL_TEXT_MAX = 8000;

const ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'" };

/** HTML email as plain text: line breaks kept, quoted older emails (blockquote) left out, tags and styles gone. */
export function htmlToText(html: string): string {
  let s = String(html ?? "");
  s = s.replace(/<!--[\s\S]*?-->/g, "").replace(/<(head|style|script|title)\b[\s\S]*?<\/\1\s*>/gi, "");
  // Innermost quotes first, until none are left.
  for (let i = 0; i < 20 && /<blockquote\b/i.test(s); i++) {
    const next = s.replace(/<blockquote\b[^>]*>(?:(?!<blockquote\b)[\s\S])*?<\/blockquote\s*>/gi, "\n");
    if (next === s) break;
    s = next;
  }
  s = s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/(p|div|tr|h[1-6]|ul|ol|table|blockquote|pre)\s*>/gi, "\n")
    .replace(/<\/t[dh]\s*>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z0-9]{2,8});/gi, (m, e: string) => {
      const k = e.toLowerCase();
      if (ENTITIES[k]) return ENTITIES[k];
      const n = k.startsWith("#x") ? parseInt(k.slice(2), 16) : k.startsWith("#") ? parseInt(k.slice(1), 10) : NaN;
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    });
  return cleanText(s);
}

/** Where the older email starts, in the languages people write most: "On ... wrote:", Outlook's headers, and more. */
const QUOTE_HEADS: RegExp[] = [
  /^On\b.{0,300}\bwrote:\s*$/i,
  /^-{2,}\s*Original Message\s*-{2,}\s*$/i,
  /^Le\b.{0,300}\ba écrit\s*:\s*$/i,
  /^Am\b.{0,300}\bschrieb.{0,100}:\s*$/i,
  /^El\b.{0,300}\bescribió:\s*$/i,
];
/** Outlook's quote: a "From:" line with "Sent:" or "Date:" and "To:" or "Subject:" within the next lines. */
const isOutlookHead = (lines: string[], i: number) =>
  /^\*?From:\*?\s/i.test(lines[i]) && lines.slice(i + 1, i + 5).some((l) => /^\*?(Sent|Date):\*?\s/i.test(l)) && lines.slice(i + 1, i + 6).some((l) => /^\*?(To|Subject):\*?\s/i.test(l));

/** Where the signature starts: the "-- " line, and the lines phones and apps add. */
const SIGNATURE: RegExp[] = [/^--\s*$/, /^Sent from my \w+/i, /^Sent from (Mail|Yahoo Mail|Outlook|Gmail)\b/i, /^Get Outlook for \w+/i, /^Sent with Proton Mail/i];

/** A forward's marker line. Everything after it is the forwarded email. */
const FORWARD = /^(-{2,}\s*Forwarded message\s*-{2,}|Begin forwarded message:)\s*$/i;
/** Outlook marks a forward like a reply, so with a Fwd: subject its "Original Message" line counts too. */
const OUTLOOK_FORWARD = /^-{2,}\s*Original Message\s*-{2,}\s*$/i;

/**
 * The person's own words: the text cut where a quoted older email starts (or at "> " lines), and where the signature
 * starts. A forward keeps the forwarded email after the person's note, without the note's signature.
 * Empty when nothing is left (the caller then uses the subject).
 */
export function trimEmail(raw: string, o: { forward?: boolean } = {}): string {
  const lines = cleanText(raw).split("\n");
  const fwd = lines.findIndex((l, i) => FORWARD.test(l.trim()) || (o.forward === true && (OUTLOOK_FORWARD.test(l.trim()) || isOutlookHead(lines, i))));
  if (o.forward || fwd >= 0) {
    if (fwd >= 0) {
      const note = cutSignature(lines.slice(0, fwd));
      const forwarded = lines.slice(fwd).map((l) => l.replace(/^>\s?/, ""));
      return capText(cleanText([...note, ...(note.length ? [""] : []), ...forwarded].join("\n")), EMAIL_TEXT_MAX);
    }
    return capText(cleanText(lines.join("\n")), EMAIL_TEXT_MAX);
  }
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    // "On Mon, Nov 18, 2026 at 9:00 AM Ana <ana@x.com>" and "wrote:" are sometimes split over two lines.
    const two = i + 1 < lines.length ? `${l} ${lines[i + 1].trim()}` : l;
    if (QUOTE_HEADS.some((r) => r.test(l) || (/^(On|Le|Am|El)\b/.test(l) && r.test(two))) || isOutlookHead(lines, i) || /^_{10,}$/.test(l) && lines.slice(i + 1, i + 3).some((x) => /^From:/i.test(x))) {
      end = i;
      break;
    }
  }
  const own = cutSignature(lines.slice(0, end).filter((l) => !/^\s*>/.test(l)));
  return capText(cleanText(own.join("\n")), EMAIL_TEXT_MAX);
}

function cutSignature(lines: string[]): string[] {
  const at = lines.findIndex((l) => SIGNATURE.some((r) => r.test(l)));
  return at >= 0 ? lines.slice(0, at) : lines;
}

/** The text of a received email: its plain text when it has some, else its HTML as text. */
export function emailText(e: { text?: string | null; html?: string | null }): string {
  const t = typeof e.text === "string" ? e.text : "";
  return t.trim() ? t : typeof e.html === "string" ? htmlToText(e.html) : "";
}
