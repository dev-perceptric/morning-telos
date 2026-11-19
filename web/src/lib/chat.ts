// The chat request and its NDJSON stream, shared by POST /api/chat and the chat screen. Pure.
import type { ChatEvent } from "./agentLoop.ts";
import { isModelChoice, type ModelChoice } from "./models.ts";
import { isAgentKey, type AgentKey } from "./team.ts";

export const MAX_MESSAGE = 8000;

export const CHAT_MESSAGES = {
  empty: "Type a message.",
  tooLong: `That message is too long. Keep it under ${MAX_MESSAGE.toLocaleString("en-US")} letters.`,
  badThread: "That chat was not found.",
  badRoutine: "That routine was not found.",
  tooMany: "That's a lot of messages this hour. Try again soon.",
  nothingToRetry: "There is no message to answer again in this chat.",
} as const;

/**
 * routineId: Run now on the Routines page. The routine's own words and teammate are used, in a new chat.
 * again: Retry or Ask someone else. The thread's last message from the person is answered again (by `agent`), and
 * no new message is saved.
 */
export type ChatRequest = { text: string; threadId: string | null; agent: AgentKey | null; model: ModelChoice | null; routineId: string | null; again: boolean };

/** Checks the body of POST /api/chat. Unknown agents and models are ignored, not errors. */
export function readChat(body: Record<string, unknown>): { ok: true; value: ChatRequest } | { ok: false; error: string } {
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return { ok: false, error: CHAT_MESSAGES.empty };
  if (text.length > MAX_MESSAGE) return { ok: false, error: CHAT_MESSAGES.tooLong };
  const threadId = typeof body.threadId === "string" && body.threadId ? body.threadId : null;
  const routineId = typeof body.routineId === "string" && body.routineId ? body.routineId : null;
  const again = body.again === true && Boolean(threadId) && !routineId;
  return { ok: true, value: { text, threadId, agent: isAgentKey(body.agent) ? body.agent : null, model: isModelChoice(body.model) ? body.model : null, routineId, again } };
}

/** At most `max` messages per workspace in `windowMs`. Kept in memory, like the old app's limited(). */
export function rateLimiter(max: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return (key: string, now = Date.now()): boolean => {
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      hits.set(key, recent);
      return true;
    }
    recent.push(now);
    hits.set(key, recent);
    return false;
  };
}

/** One event as one NDJSON line. */
export const ndjsonLine = (e: ChatEvent) => `${JSON.stringify(e)}\n`;

/** Splits what has arrived so far into whole lines. The rest waits for the next chunk. Bad lines are skipped. */
export function readLines(buffer: string): { events: ChatEvent[]; rest: string } {
  const parts = buffer.split("\n");
  const rest = parts.pop() ?? "";
  const events: ChatEvent[] = [];
  for (const line of parts) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (e && typeof e === "object" && typeof e.type === "string") events.push(e as ChatEvent);
    } catch {
      // A broken line is skipped. The next one still shows.
    }
  }
  return { events, rest };
}

/** Pieces of a reply for the screen: plain text and **bold**. Everything is text, so nothing in a reply runs as HTML. */
export function inlineParts(text: string): { text: string; bold: boolean }[] {
  const out: { text: string; bold: boolean }[] = [];
  const re = /\*\*([^*\n]+)\*\*/g;
  let at = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > at) out.push({ text: text.slice(at, m.index), bold: false });
    out.push({ text: m[1], bold: true });
    at = m.index! + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at), bold: false });
  return out;
}
