// The reply being written, as the chat screen follows the NDJSON stream (src/components/Chat.tsx): who is answering,
// the text so far, the one quiet line ("Leo is answering", "Theseus is checking katalon.com") and the tools
// used. Pure, so the screen and the tests share it.

import type { ChatEvent } from "./agentLoop.ts";
import { AGENTS, type AgentKey } from "./team.ts";

export type Live = {
  /** Who is answering now, or null before anyone is known. */
  answering: AgentKey | null;
  /** The text written so far, by `answering`. */
  text: string;
  /** The quiet line under the thread. Null while the text itself shows progress. */
  line: string | null;
  /** Tools used so far in this reply, for "Used: ...". */
  used: string[];
};

export const IDLE: Live = { answering: null, text: "", line: null, used: [] };

export const LIVE_WORDS = {
  finding: "Finding the right teammate",
  answering: (k: AgentKey) => `${AGENTS[k].god} is answering`,
  askElse: "Ask someone else",
  jump: "Jump to latest",
  copy: "Copy",
  copied: "Copied",
  retry: "Retry",
  stop: "Stop",
  stopped: "Stopped",
};

/** The state right after Send: the teammate when the screen can tell (quickRoute), else "Finding the right teammate". */
export function started(agent: AgentKey | null): Live {
  return { ...IDLE, answering: agent, line: agent ? LIVE_WORDS.answering(agent) : LIVE_WORDS.finding };
}

/** The next state after one event. A `message` event ends the reply: the screen keeps it as an answer. */
export function step(s: Live, e: ChatEvent): Live {
  switch (e.type) {
    case "route":
      return { ...s, answering: e.agent, line: s.text ? null : LIVE_WORDS.answering(e.agent) };
    case "status":
      // Between steps the last tool line stays, so the line doesn't flick back to "is answering".
      if (s.answering === e.agent && (s.text || s.line)) return s;
      return { ...s, answering: e.agent, text: "", line: LIVE_WORDS.answering(e.agent) };
    case "delta": {
      const fresh = e.start || s.answering !== e.agent;
      return { ...s, answering: e.agent, text: fresh ? e.text : s.text + e.text, line: null };
    }
    case "tool":
      return { ...s, answering: e.agent, line: e.line ?? e.text, used: e.used && !s.used.includes(e.used) ? [...s.used, e.used] : s.used };
    case "handoff":
      return { ...IDLE, answering: e.to, line: LIVE_WORDS.answering(e.to) };
    case "message":
      return IDLE;
    default:
      return s;
  }
}
