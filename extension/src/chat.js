// The chat stream from POST /api/chat (NDJSON, one event per line) and how replies are shown. Copied from the app's
// web/src/lib/chat.ts.

/** Splits what has arrived so far into whole lines. The rest waits for the next chunk. Bad lines are skipped. */
export function readLines(buffer) {
  const parts = String(buffer).split("\n");
  const rest = parts.pop() ?? "";
  const events = [];
  for (const line of parts) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (e && typeof e === "object" && typeof e.type === "string") events.push(e);
    } catch {
      // A broken line is skipped. The next one still shows.
    }
  }
  return { events, rest };
}

/** Pieces of a reply: plain text and **bold**. Everything is text, so nothing in a reply runs as HTML. */
export function inlineParts(text) {
  const out = [];
  const re = /\*\*([^*\n]+)\*\*/g;
  let at = 0;
  for (const m of String(text).matchAll(re)) {
    if (m.index > at) out.push({ text: text.slice(at, m.index), bold: false });
    out.push({ text: m[1], bold: true });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at), bold: false });
  return out;
}

/** A reply as plain text for a Gmail reply box: no **bold** marks and no blank lines at the ends. */
export const plainReply = (text) => String(text).replace(/\*\*([^*\n]+)\*\*/g, "$1").replace(/\r\n?/g, "\n").trim();

/** The body of POST /api/chat. The page and its screenshot go only when there is one. */
export function chatBody({ workspaceId, text, threadId, page, screenshot }) {
  const body = { workspaceId, text, threadId: threadId || null };
  if (page) body.page = { kind: page.kind, url: page.url, title: page.title, text: page.text, selection: page.selection ?? "" };
  if (page && screenshot) body.screenshot = screenshot;
  return body;
}
