// The text of an uploaded file, for a Knowledge doc. Text files are read as they are; a PDF's text is pulled out
// with unpdf (the way Arrowsterr's library route reads PDFs), so it works without a Claude key and costs nothing.
import { capText, checkUpload, CUT_NOTE, MAX_BODY, titleFromFile } from "./knowledge.ts";

export type FileText = { ok: true; title: string; text: string; cut: boolean; note: string | null } | { ok: false; error: string };

/** Plain text from a text file: UTF-8, no byte order mark, even line ends. Null when it looks like a binary file. */
export function decodeText(bytes: Uint8Array): string | null {
  const text = new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, "");
  if (text.includes("\u0000")) return null;
  return text.replace(/\r\n?/g, "\n");
}

/** The words in a PDF, page after page. Throws when the file isn't a PDF that can be opened. */
export async function pdfText(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: true });
  return String(text).replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

/** Check, read and cut an uploaded file. Never throws. */
export async function readUpload(name: string, bytes: Uint8Array): Promise<FileText> {
  const check = checkUpload(name, bytes.byteLength);
  if (!check.ok) return check;
  let text: string;
  if (check.kind === "pdf") {
    if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") return { ok: false, error: "That file isn't a PDF we can read." };
    try {
      text = await pdfText(bytes);
    } catch {
      return { ok: false, error: "That file isn't a PDF we can read." };
    }
    if (!text) return { ok: false, error: "We couldn't find any text in this PDF. It may be a scan. Copy the text into a new doc instead." };
  } else {
    const decoded = decodeText(bytes);
    if (decoded === null) return { ok: false, error: "That file isn't plain text. Upload a .txt, .md, .csv or .pdf file." };
    text = decoded.trim();
    if (!text) return { ok: false, error: "That file is empty." };
  }
  const capped = capText(text, MAX_BODY);
  return { ok: true, title: titleFromFile(name), text: capped.text, cut: capped.cut, note: capped.cut ? CUT_NOTE : null };
}
