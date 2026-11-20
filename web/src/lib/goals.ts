// Goals: a target the team works toward (a metric, a number, a unit, a due date, the teammate who owns it and the
// chat it lives in), and its plan's steps (supabase/023_goals.sql). The person starts a goal from a goal card and
// a plan from a plan card (src/components/Cards.tsx); teammates move the steps and log the number with
// update_step and log_progress (src/lib/cardTools.ts); a job on Monday posts a check-in in each active goal's chat
// (src/lib/goalsServer.ts). Pure and shared with the browser: the number from real data, the progress card, the
// weekly check-in's words.

import { goalSentence, goalStatus, numLabel, type Metric, type Point, type ProgressCard } from "./cards.ts";
import { AGENTS, type AgentKey } from "./team.ts";

export type GoalRow = {
  id: string;
  workspace_id: string;
  thread_id: string;
  card_id: string;
  agent: AgentKey;
  metric: Metric;
  title: string;
  target: number;
  unit: string;
  due_date: string;
  status: "active" | "done" | "stopped";
  current: number;
  baseline: number | null;
  history: Point[];
  checked_at: string | null;
  created_at: string;
};
export const GOAL_COLUMNS = "id, workspace_id, thread_id, card_id, agent, metric, title, target, unit, due_date, status, current, baseline, history, checked_at, created_at";

export type StepRow = { id: string; plan_id: string; goal_id: string | null; position: number; title: string; agent: AgentKey; status: "todo" | "running" | "done" };
export const STEP_COLUMNS = "id, plan_id, goal_id, position, title, agent, status";

/** A goal row as the database gives it: numbers as numbers (numeric columns can come back as text). */
export function goalOf(r: Record<string, unknown>): GoalRow {
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    ...(r as unknown as GoalRow),
    target: Number(r.target),
    current: Number(r.current ?? 0),
    baseline: n(r.baseline),
    history: Array.isArray(r.history) ? (r.history as Point[]).filter((p) => p && typeof p.at === "string" && Number.isFinite(Number(p.value))).map((p) => ({ at: p.at, value: Number(p.value) })) : [],
    due_date: String(r.due_date).slice(0, 10),
  };
}

/** Where each metric's number comes from: the social results, the SEO tools, or the teammate. */
export const METRIC_SOURCE: Record<Metric, { product: "capybaroar" | "arrowsterr"; tool: string; input: Record<string, unknown>; keys: string[]; gain: boolean } | null> = {
  // Followers count up from where the goal started: the first reading is the starting point.
  followers: { product: "capybaroar", tool: "get_analytics", input: { days: 30 }, keys: ["followers", "follower_count", "followers_count", "total_followers", "audience"], gain: true },
  reach: { product: "capybaroar", tool: "get_analytics", input: { days: 30 }, keys: ["reach", "total_reach", "impressions"], gain: false },
  ai_visibility: { product: "arrowsterr", tool: "get_ai_visibility", input: { days: 30 }, keys: ["visibility", "visibility_pct", "ai_visibility"], gain: false },
  other: null,
};

/**
 * The metric's number in a tool's answer (JSON, or text like "Visibility: 23%"), or null. In JSON, a key at the top
 * level wins over one inside; an object like {current: 23, previous: 18} gives its current value.
 */
export function pickMetric(answer: string, keys: string[]): number | null {
  const toNum = (v: unknown): number | null => {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && /^-?[\d,]+(\.\d+)?%?$/.test(v.trim())) return Number(v.replace(/[,%]/g, ""));
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const o = v as Record<string, unknown>;
      for (const k of ["current", "value", "total", "now"]) if (k in o) return toNum(o[k]);
    }
    return null;
  };
  try {
    const data = JSON.parse(answer) as unknown;
    let level: unknown[] = [data];
    for (let depth = 0; depth < 5 && level.length; depth++) {
      for (const node of level) {
        if (!node || typeof node !== "object" || Array.isArray(node)) continue;
        const o = node as Record<string, unknown>;
        for (const k of keys) if (k in o && toNum(o[k]) !== null) return toNum(o[k]);
      }
      level = level.flatMap((node) => (node && typeof node === "object" ? Object.values(node as Record<string, unknown>) : []));
    }
    return null;
  } catch {
    for (const k of keys) {
      const m = answer.match(new RegExp(`${k.replace(/_/g, "[ _]")}\\W{0,4}(-?[\\d,]+(?:\\.\\d+)?)`, "i"));
      if (m) return Number(m[1].replace(/,/g, ""));
    }
    return null;
  }
}

/** The day of a time, in UTC: "2026-11-20". */
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * The goal after a new reading. `reading` is the raw number (total followers, visibility). A metric that counts up
 * from the start keeps its first reading as the baseline and shows the gain. History keeps one point a day, at most
 * 200. A goal that reaches its target is done.
 */
export function applyReading(g: Pick<GoalRow, "metric" | "target" | "baseline" | "history" | "status">, reading: number, o: { now?: number; raw?: boolean } = {}): { current: number; baseline: number | null; history: Point[]; checked_at: string; status: GoalRow["status"] } {
  const now = o.now ?? Date.now();
  const gain = o.raw !== false && METRIC_SOURCE[g.metric]?.gain === true;
  const baseline = gain ? (g.baseline ?? reading) : g.baseline;
  const current = Math.round((gain ? reading - (baseline ?? reading) : reading) * 100) / 100;
  const today = dayOf(now);
  const history = [...g.history.filter((p) => p.at !== today), { at: today, value: current }].slice(-200);
  return { current, baseline, history, checked_at: new Date(now).toISOString(), status: g.status === "active" && current >= g.target ? "done" : g.status };
}

const lead = (g: Pick<GoalRow, "title">) => g.title;
/** The goal in one line, as cards and check-ins say it. */
export const goalLine = (g: Pick<GoalRow, "title" | "target" | "unit" | "due_date">, now = Date.now()) => goalSentence({ lead: lead(g), target: g.target, unit: g.unit, due: g.due_date }, now);

/** The progress card for a goal, from its row. Built by the server, then checked like any card (readCard). */
export function progressCard(g: GoalRow, o: { now?: number; pending?: number } = {}): Omit<ProgressCard, "id" | "agent" | "note"> & { kind: "progress" } {
  return {
    kind: "progress",
    title: "Progress",
    goal_id: g.id,
    lead: lead(g),
    target: g.target,
    unit: g.unit,
    due: g.due_date,
    start: g.created_at.slice(0, 10),
    current: g.current,
    points: g.history.slice(-60),
    status: goalStatus(g, o),
  };
}

/** What the teammate is told when the Monday check-in runs, saved in the goal's chat as a note. */
export function checkinPrompt(g: Pick<GoalRow, "title" | "target" | "unit" | "due_date" | "current" | "agent">, now = Date.now()): string {
  return [
    `Weekly check-in for the goal "${goalLine(g, now)}". It stands at ${numLabel(g.current)} of ${numLabel(g.target)} ${g.unit}.`,
    `${AGENTS[g.agent].god}, post this week's check-in: call log_progress first, then say the number, what the team did this week, and the one change for next week. Keep it to a few short lines. End with quick_replies.`,
  ].join(" ");
}

/** The short line the chat shows for a check-in note. */
export const CHECKIN_LABEL = "Weekly check-in";

