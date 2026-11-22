// Routines: a teammate does the same job on a schedule, like "every Monday at 8am, Leo plans the week's posts".
// Pure, so the Routines page, the server and the tests share one set of rules. Ported from the old app's routines
// routes and scheduler (app/server.js runRoutine and tick()), with the table in supabase/014_routines_skills_memory.sql.
// Which minute is due is decided in SQL (due_routines), in each workspace's own time zone.

import { AGENTS, isAgentKey, workingAgents, type AgentKey } from "./team.ts";

export const MAX_ROUTINES = 25;
export const MAX_TITLE = 120;
export const MAX_INSTRUCTION = 4000;
export const DEFAULT_DAYS = [1, 2, 3, 4, 5];
export const DEFAULT_TIME = "08:00";
/** Sunday first, the way the days are saved (0 to 6). */
export const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export type Routine = {
  id: string;
  agent: AgentKey;
  title: string;
  instruction: string;
  days: number[];
  at_time: string;
  enabled: boolean;
  last_run_at: string | null;
  last_note: string | null;
  last_thread_id: string | null;
};

export type RoutineInput = { agent: AgentKey; title: string; instruction: string; days: number[]; at_time: string };

const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

/** Check a routine from the form. Returns what to save, or a message to show. */
export function cleanRoutine(input: { agent?: unknown; title?: unknown; instruction?: unknown; days?: unknown; at_time?: unknown }): { ok: true; value: RoutineInput } | { ok: false; error: string } {
  if (!isAgentKey(input.agent) || !workingAgents().includes(input.agent)) return { ok: false, error: "Pick a teammate." };
  const title = String(input.title ?? "").replace(/\s+/g, " ").trim();
  const instruction = String(input.instruction ?? "").replace(/\r\n?/g, "\n").trim();
  if (!title) return { ok: false, error: "Give the routine a name." };
  if (title.length > MAX_TITLE) return { ok: false, error: `The name can be up to ${MAX_TITLE} letters.` };
  if (!instruction) return { ok: false, error: "Say what the teammate should do." };
  if (instruction.length > MAX_INSTRUCTION) return { ok: false, error: `Keep what to do under ${MAX_INSTRUCTION.toLocaleString("en-US")} letters.` };
  const days = [...new Set((Array.isArray(input.days) ? input.days : []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  if (!days.length) return { ok: false, error: "Pick at least one day." };
  const at = String(input.at_time ?? "").trim();
  if (!TIME.test(at)) return { ok: false, error: "Pick a time." };
  return { ok: true, value: { agent: input.agent, title, instruction, days, at_time: at } };
}

/** "Every day", "Weekdays", "Weekends" or "Mon, Wed, Fri". */
export function daysText(days: number[]): string {
  const d = [...new Set(days)].filter((x) => x >= 0 && x <= 6).sort();
  if (d.length === 7) return "Every day";
  if (d.join() === "1,2,3,4,5") return "Weekdays";
  if (d.join() === "0,6") return "Weekends";
  return d.map((x) => DAYS[x]).join(", ");
}

/** "8:00 AM" from "08:00". */
export function timeText(at: string): string {
  if (!TIME.test(at)) return at;
  const [h, m] = at.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** The chat a run makes is called this (the old app's title). */
export const routineThreadTitle = (title: string) => `Routine: ${title}`.slice(0, 200);

/** Why a scheduled run was skipped. Saved on the routine and shown on the Routines page. */
export const SKIP_NOTES = {
  paused: (k: AgentKey) => `Skipped: ${AGENTS[k].god} is paused. Turn them back on in Team.`,
  soon: (k: AgentKey) => `Skipped: ${AGENTS[k].god} can't take work yet.`,
  starting: "Skipped: your AI team was starting up.",
  /** The plan ended or this period's AI allowance is used up (the meter's own words, from aiBlock). */
  blocked: (text: string) => `Skipped. ${text}`,
} as const;
