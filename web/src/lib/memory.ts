// Memory: short, lasting facts about the business that teammates learn in chats and keep, like "Closed on Mondays"
// or "The owner wants posts to sound warm, not salesy". The remember tool saves them; every teammate reads the newest
// ones in its prompt. Members see each fact with where it came from on the Memory page, and delete what's wrong.
// Pure, so the tool, the prompt, the screens and the tests share one set of rules. Table: memories in
// supabase/014_routines_skills_memory.sql.

import type Anthropic from "@anthropic-ai/sdk";
import type { AgentKey } from "./team.ts";

export const MAX_FACT = 500;
export const MAX_MEMORIES = 200;
/** How much of the prompt the facts may use. About 1,500 tokens. */
export const MEMORY_BUDGET = 6000;

export type Memory = { id: string; agent: AgentKey | null; fact: string; thread_id: string | null; created_at: string };

export const MEMORY_MESSAGES = {
  empty: "Write the fact to remember.",
  tooLong: `Keep a fact under ${MAX_FACT} characters. Save the main point only.`,
  secret: "That looks like a password, key or card number. Never save those. Tell the owner to keep it somewhere safe instead.",
  full: `Memory is full (${MAX_MEMORIES} facts). Ask the owner to delete old facts on the Memory page.`,
  saved: "Saved to memory.",
  same: "Already in memory.",
  updated: "Updated the fact in memory.",
} as const;

/** The words of a fact without case, spaces or punctuation, the same as fact_key in SQL. */
export const factKey = (fact: string) =>
  fact
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** A fact on one line, with its spaces tidied. */
export const cleanFact = (fact: unknown) => String(fact ?? "").replace(/\s+/g, " ").trim();

// Prefixes of real keys and tokens (Stripe, Anthropic, OpenAI, GitHub, Slack, AWS, Google, our partner keys), JWTs,
// private key blocks, and words that say a secret follows.
const KEY_PREFIX = /\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{8,}|\bsk-[A-Za-z0-9_-]{16,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bxox[abprs]-[A-Za-z0-9-]{10,}|\bAKIA[0-9A-Z]{16}\b|\bAIza[0-9A-Za-z_-]{30,}|\b(aw|cb)_(partner|brand)_[A-Za-z0-9]{8,}|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const SECRET_WORD = /\b(password|passwd|passcode|pin|pin code|api[ _-]?key|secret key|client secret|access[ _-]?token|auth[ _-]?token|token|private[ _-]?key|login code|2fa code|one[ -]time code|security code|cvv|cvc)(\s+(is|was)\s+|\s*[=:]\s*)\S+/i;

/** Luhn check, so a card number reads as one but a phone number usually doesn't. */
function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/**
 * True when a fact looks like it holds a secret: a key or token, a password or code, a card number, or a long random
 * string. Errs on the side of refusing: a fact about the business never needs one.
 */
export function looksSecret(fact: string): boolean {
  if (KEY_PREFIX.test(fact) || SECRET_WORD.test(fact)) return true;
  for (const m of fact.matchAll(/\b(?:\d[ -]?){13,19}\b/g)) {
    const digits = m[0].replace(/\D/g, "");
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) return true;
  }
  // A long run of letters and digits mixed together, like a token. Words, links, emails and dates don't qualify.
  for (const m of fact.matchAll(/[A-Za-z0-9_\-+/=]{24,}/g)) {
    const t = m[0];
    if (/[a-z]/.test(t) && /[A-Z]/.test(t) && /\d/.test(t)) return true;
    if (/^[a-f0-9]{32,}$/i.test(t)) return true;
  }
  return false;
}

export type RememberPlan =
  | { action: "add"; fact: string }
  | { action: "same"; id: string }
  | { action: "replace"; id: string; fact: string }
  | { action: "refuse"; reason: string };

/**
 * What saving a fact does, given the facts already saved: refuse it (empty, too long, a secret, memory full), keep the
 * one already there (the same words, or a longer fact that says it all), replace one this fact says more than, or add it.
 */
export function planRemember(existing: Pick<Memory, "id" | "fact">[], raw: unknown): RememberPlan {
  const fact = cleanFact(raw);
  if (!fact) return { action: "refuse", reason: MEMORY_MESSAGES.empty };
  if (fact.length > MAX_FACT) return { action: "refuse", reason: MEMORY_MESSAGES.tooLong };
  if (looksSecret(fact)) return { action: "refuse", reason: MEMORY_MESSAGES.secret };
  const key = factKey(fact);
  if (!key) return { action: "refuse", reason: MEMORY_MESSAGES.empty };
  const padded = (k: string) => ` ${k} `;
  for (const m of existing) {
    const k = factKey(m.fact);
    if (k === key || padded(k).includes(padded(key))) return { action: "same", id: m.id };
  }
  const older = existing.find((m) => {
    const k = factKey(m.fact);
    return k && padded(key).includes(padded(k));
  });
  if (older) return { action: "replace", id: older.id, fact };
  if (existing.length >= MAX_MEMORIES) return { action: "refuse", reason: MEMORY_MESSAGES.full };
  return { action: "add", fact };
}

// Text from chats must not close our tags and pass for our own instructions.
const safe = (s: string) => s.replace(/<\/?(memory|fact)\b/gi, (m) => m.replace("<", "&lt;"));

/** The line an agent sees when nothing is saved yet. */
export const NO_MEMORY = "(Nothing saved yet.)";

/**
 * The memory part of a teammate's system prompt: facts for everyone and for this teammate, newest first, while they
 * fit in `budgetChars`. Older facts that don't fit are left out (and counted). Stable between turns, so it caches.
 */
export function memorySection(facts: Pick<Memory, "agent" | "fact" | "created_at">[], agent: AgentKey, budgetChars = MEMORY_BUDGET): string {
  const list = facts.filter((f) => f.agent === null || f.agent === agent).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const intro = `What the team has learned about this business in earlier chats. Trust it unless the person says otherwise. When you learn a lasting fact the team should keep (a preference, a rule, a detail that isn't in Knowledge), save it with remember. Never save passwords, keys or card numbers.`;
  if (!list.length) return `${intro}\n\n<memory>\n${NO_MEMORY}\n</memory>`;
  const lines: string[] = [];
  let used = 0;
  for (const f of list) {
    const line = `- ${safe(cleanFact(f.fact))} (${f.created_at.slice(0, 10)})`;
    if (used + line.length + 1 > Math.max(0, budgetChars)) break;
    lines.push(line);
    used += line.length + 1;
  }
  const left = list.length - lines.length;
  return `${intro}\n\n<memory>\n${lines.join("\n") || NO_MEMORY}${left ? `\n(${left} older ${left === 1 ? "fact" : "facts"} not shown.)` : ""}\n</memory>`;
}

/** The remember tool definition. */
export const REMEMBER: Anthropic.Beta.BetaTool = {
  name: "remember",
  description:
    "Save one short, lasting fact about the business so the whole team knows it in later chats, like a preference, a rule or a detail that isn't in Knowledge. One fact per call, under 500 characters. Never passwords, keys, codes or card numbers. Don't save things that change daily or that are already in your prompt.",
  input_schema: {
    type: "object",
    properties: {
      fact: { type: "string", description: "The fact in one plain sentence, like 'The bakery is closed on Mondays.'" },
      just_me: { type: "boolean", description: "True when only you need it. Default false: the whole team sees it." },
    },
    required: ["fact"],
  },
};
