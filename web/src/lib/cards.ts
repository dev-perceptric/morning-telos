// Answer cards: small interactive pieces a teammate puts under a reply (questions with options, quick replies, a
// table, a chart, a Connect button, a post or email to approve, a goal, a plan, progress). Shaped like the approved
// demo (Outcome Chat). The model asks for one with the show_card tool (src/lib/cardTools.ts) and the goal tools; the
// server checks it here against a strict schema, sends it on the stream as a `card` event and saves it on the message
// (meta.cards), so it shows again after a reload. The screen draws it in src/components/Cards.tsx.
//
// Every card is plain data. Text is kept as text: no HTML, no Markdown, control and direction characters removed,
// and React escapes it on screen. Internal product names never reach the person (hideNames).
//
// Buttons on cards can only do two things: send a message as the person (choices, quick replies, row actions), or
// decide an approval the tool call already saved (post and email previews), through POST /api/approvals/:id like the
// Approvals page. Nothing on a card posts, sends or changes anything by itself.
// Pure and shared with the browser.

import { setPath } from "./approvals.ts";
import { AGENTS, agentByGod, isAgentKey, type AgentKey } from "./team.ts";

// ─────────────── names the person never sees ───────────────

/** The services behind the team. Their names never show in cards, replies or prompts. */
export const INTERNAL_NAMES = ["Capybaroar", "Arrowsterr", "Composio", "MoltSets", "DataForSEO"] as const;

const SWAP: [RegExp, string][] = [
  [/capybaroar(?:'s)?/gi, "your social tools"],
  [/arrowsterr(?:'s)?/gi, "your SEO tools"],
  [/composio(?:'s)?/gi, "your apps"],
  [/moltsets(?:'s)?/gi, "lead search"],
  [/data\s?for\s?seo(?:'s)?/gi, "search data"],
];

/** The text with every internal product name swapped for what it does. */
export function hideNames(text: string): string {
  let s = String(text ?? "");
  for (const [re, word] of SWAP) s = s.replace(re, word);
  return s;
}

/** True when the text names one of the services behind the team. */
export const namesInternal = (text: string) => SWAP.some(([re]) => new RegExp(re.source, "i").test(String(text ?? "")));

// ─────────────── the cards ───────────────

export const CARD_KINDS = ["choices", "quick_replies", "table", "chart", "connect", "post_preview", "email_preview", "goal", "plan", "progress"] as const;
export type CardKind = (typeof CARD_KINDS)[number];
/** Kinds the show_card tool makes. Goal, plan and progress come from set_goal, set_plan and log_progress. */
export const SHOW_KINDS = ["choices", "quick_replies", "table", "chart", "connect", "post_preview", "email_preview"] as const;
export type ShowKind = (typeof SHOW_KINDS)[number];

export const NETWORKS = ["linkedin", "instagram", "facebook", "x"] as const;
export type Network = (typeof NETWORKS)[number];
export const NETWORK_NAME: Record<Network, string> = { linkedin: "LinkedIn", instagram: "Instagram", facebook: "Facebook", x: "X" };
/** Longest post each look-alike frame takes, as each network allows. */
export const NETWORK_LIMIT: Record<Network, number> = { linkedin: 3000, instagram: 2200, facebook: 5000, x: 280 };

/** Goal metrics. Followers and reach are read from the social results, AI visibility from the SEO tools. */
export const METRICS = ["followers", "reach", "ai_visibility", "other"] as const;
export type Metric = (typeof METRICS)[number];

export type Question = { label: string; options: string[]; multi: boolean; picked: string[] };
export type TableCell = string | number;
export type SendAction = { label: string; message: string };
export type PostItem = { approval_id: number | null; network: Network; text: string; when: string | null; image_text: string | null; index: number };
export type PlanStep = { title: string; agent: AgentKey; note: string | null };
export type Point = { at: string; value: number };

type Base = { id: string; agent: AgentKey; title: string | null; note: string | null };
export type ChoicesCard = Base & { kind: "choices"; questions: Question[]; submit: string };
export type QuickRepliesCard = Base & { kind: "quick_replies"; replies: string[] };
export type TableCard = Base & { kind: "table"; columns: string[]; numeric: boolean[]; rows: { cells: TableCell[]; action: SendAction | null }[]; actions: SendAction[] };
export type ChartCard = Base & { kind: "chart"; type: "line" | "bar"; labels: string[]; values: number[]; unit: string | null };
export type ConnectCard = Base & { kind: "connect"; app: string; text: string };
export type PostPreviewCard = Base & { kind: "post_preview"; brand: string; posts: PostItem[] };
export type EmailPreviewCard = Base & { kind: "email_preview"; approval_id: number | null; to: string; subject: string; body: string };
export type GoalCard = Base & { kind: "goal"; metric: Metric; lead: string; target: number; unit: string; due: string; step: number };
export type PlanCard = Base & { kind: "plan"; steps: PlanStep[]; go: string };
export type ProgressCard = Base & { kind: "progress"; goal_id: string; lead: string; target: number; unit: string; due: string; start: string; current: number; points: Point[]; status: GoalStatus };
export type Card = ChoicesCard | QuickRepliesCard | TableCard | ChartCard | ConnectCard | PostPreviewCard | EmailPreviewCard | GoalCard | PlanCard | ProgressCard;

export type GoalStatus = "on_track" | "needs_you" | "done";
export const GOAL_STATUS_LABEL: Record<GoalStatus, string> = { on_track: "On track", needs_you: "Needs you", done: "Done" };

/** How big a card may get. The server refuses a card past these, saying which limit, so the teammate can fix it. */
export const LIMITS = {
  cardsPerReply: 6,
  title: 80,
  note: 60,
  questions: 4,
  options: 8,
  option: 60,
  label: 120,
  submit: 40,
  replies: [2, 4] as const,
  reply: 60,
  columns: 8,
  rows: 50,
  cell: 200,
  actions: 3,
  message: 500,
  points: [2, 60] as const,
  chartLabel: 24,
  connectText: 160,
  posts: 10,
  postText: 5000,
  imageText: 80,
  when: 40,
  to: 320,
  subject: 200,
  body: 10_000,
  steps: 8,
  stepTitle: 120,
  stepNote: 80,
  lead: 60,
  unit: 30,
  maxTarget: 1_000_000_000,
} as const;

/** A card id: "c_" and 12 letters or digits. Goals and plans keep it (supabase/023_goals.sql). */
export const CARD_ID = /^c_[a-z0-9]{8,32}$/;
export function newCardId(rand: () => string = () => globalThis.crypto.randomUUID()): string {
  return `c_${rand().replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 12).padEnd(12, "0")}`;
}

// ─────────────── checking ───────────────

class Bad extends Error {}
const bad = (path: string, why: string): never => {
  throw new Bad(`${path}: ${why}`);
};

// Control characters (but not new lines and tabs), direction overrides and zero-width characters.
const JUNK = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁠-⁩﻿]/g;

/** Plain text: junk characters out, new lines kept only where allowed, trimmed, internal names swapped. */
export function cleanText(v: string, lines = false): string {
  const s = String(v).replace(/\r\n?/g, "\n").replace(JUNK, "");
  const one = lines ? s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n") : s.replace(/\s+/g, " ");
  return hideNames(one.trim());
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function fields(v: unknown, path: string, allowed: readonly string[]): Record<string, unknown> {
  if (!isObj(v)) bad(path, "must be an object");
  const o = v as Record<string, unknown>;
  const extra = Object.keys(o).filter((k) => !allowed.includes(k) && o[k] !== undefined && o[k] !== null);
  if (extra.length) bad(path, `unknown field${extra.length > 1 ? "s" : ""} ${extra.join(", ")}. Allowed: ${allowed.join(", ")}`);
  return o;
}

function text(v: unknown, path: string, max: number, o: { lines?: boolean } = {}): string {
  if (typeof v !== "string" && typeof v !== "number") bad(path, "must be text");
  const s = cleanText(String(v), o.lines);
  if (!s) bad(path, "can't be empty");
  if (s.length > max) bad(path, `is ${s.length} characters, at most ${max}`);
  return s;
}
const maybeText = (v: unknown, path: string, max: number, o: { lines?: boolean } = {}) => (v === undefined || v === null || v === "" ? null : text(v, path, max, o));

function num(v: unknown, path: string, o: { min?: number; max?: number; int?: boolean } = {}): number {
  const n = typeof v === "number" ? v : typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : NaN;
  if (!Number.isFinite(n)) bad(path, "must be a number");
  if (o.int && !Number.isInteger(n)) bad(path, "must be a whole number");
  if (o.min !== undefined && n < o.min) bad(path, `must be at least ${o.min}`);
  if (o.max !== undefined && n > o.max) bad(path, `must be at most ${o.max}`);
  return n;
}

function list(v: unknown, path: string, min: number, max: number): unknown[] {
  if (!Array.isArray(v)) bad(path, "must be a list");
  const a = v as unknown[];
  if (a.length < min) bad(path, `needs at least ${min}`);
  if (a.length > max) bad(path, `has ${a.length}, at most ${max}`);
  return a;
}

function oneOf<T extends string>(v: unknown, path: string, options: readonly T[]): T {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (!(options as readonly string[]).includes(s)) bad(path, `must be one of ${options.join(", ")}`);
  return s as T;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** A real calendar day, "2027-01-31". */
export function isDay(v: unknown): v is string {
  if (typeof v !== "string" || !DAY.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
function day(v: unknown, path: string): string {
  if (!isDay(v)) bad(path, "must be a date like 2027-01-31");
  return v as string;
}

function teammate(v: unknown, path: string, fallback: AgentKey): AgentKey {
  if (v === undefined || v === null || v === "") return fallback;
  const k = isAgentKey(v) ? v : agentByGod(v);
  if (!k) bad(path, "must be a teammate's name, like Aphrodite");
  return k as AgentKey;
}

const approvalRef = (v: unknown, path: string): number | null => (v === undefined || v === null || v === "" ? null : num(v, path, { min: 1, max: Number.MAX_SAFE_INTEGER, int: true }));

const uniq = (xs: string[], path: string) => {
  const seen = new Set<string>();
  for (const x of xs) {
    const k = x.toLowerCase();
    if (seen.has(k)) bad(path, `"${x}" is there twice`);
    seen.add(k);
  }
  return xs;
};

/** A table cell: numbers stay numbers. */
function cell(v: unknown, path: string): TableCell {
  if (typeof v === "number") {
    if (!Number.isFinite(v)) bad(path, "must be a real number");
    return v;
  }
  if (v === null || v === undefined || v === "") return "";
  return text(v, path, LIMITS.cell);
}
/** "1,240", "12.5%", "$80" and "-3" read as numbers, so their column lines up on the right. */
export const looksNumeric = (c: TableCell) => typeof c === "number" || /^[+-]?[$€£]?\d[\d,]*(\.\d+)?\s?(%|k|m)?$/i.test(String(c).trim());

function sendAction(v: unknown, path: string): SendAction {
  const o = fields(v, path, ["label", "message"]);
  return { label: text(o.label, `${path}.label`, LIMITS.reply), message: text(o.message, `${path}.message`, LIMITS.message) };
}

// One reader per kind. Each gets the card's fields (without kind) and returns the card's own part.
type Reader = (o: Record<string, unknown>, agent: AgentKey) => Omit<Card, keyof Base>;
// agent is always the teammate showing it (readCard's own argument), and a table's numeric columns are worked out
// again, so a saved card reads back as it was.
const COMMON = ["kind", "id", "title", "note", "agent"];

const READERS: Record<CardKind, { fields: string[]; read: Reader }> = {
  choices: {
    fields: ["questions", "submit"],
    read: (o) => ({
      kind: "choices",
      questions: list(o.questions, "questions", 1, LIMITS.questions).map((q, i) => {
        const p = `questions[${i}]`;
        const f = fields(q, p, ["label", "options", "multi", "picked"]);
        const options = uniq(list(f.options, `${p}.options`, 2, LIMITS.options).map((x, j) => text(x, `${p}.options[${j}]`, LIMITS.option)), `${p}.options`);
        const multi = f.multi === true;
        const wanted = f.picked === undefined || f.picked === null ? [] : (Array.isArray(f.picked) ? f.picked : [f.picked]).map((x, j) => text(x, `${p}.picked[${j}]`, LIMITS.option));
        const picked = options.filter((x) => wanted.some((w) => w.toLowerCase() === x.toLowerCase())).slice(0, multi ? options.length : 1);
        return { label: text(f.label, `${p}.label`, LIMITS.label), options, multi, picked };
      }),
      submit: maybeText(o.submit, "submit", LIMITS.submit) ?? "Send",
    }),
  },
  quick_replies: {
    fields: ["replies"],
    read: (o) => ({ kind: "quick_replies", replies: uniq(list(o.replies, "replies", LIMITS.replies[0], LIMITS.replies[1]).map((x, i) => text(x, `replies[${i}]`, LIMITS.reply)), "replies") }),
  },
  table: {
    fields: ["columns", "rows", "actions", "numeric"],
    read: (o) => {
      const columns = list(o.columns, "columns", 1, LIMITS.columns).map((x, i) => text(x, `columns[${i}]`, LIMITS.option));
      const rows = list(o.rows, "rows", 1, LIMITS.rows).map((r, i) => {
        const p = `rows[${i}]`;
        const f = Array.isArray(r) ? { cells: r } : fields(r, p, ["cells", "action"]);
        const cells = list(f.cells, `${p}.cells`, columns.length, columns.length).map((c, j) => cell(c, `${p}.cells[${j}]`));
        return { cells, action: f.action ? sendAction(f.action, `${p}.action`) : null };
      });
      const numeric = columns.map((_, j) => rows.every((r) => r.cells[j] === "" || looksNumeric(r.cells[j])) && rows.some((r) => r.cells[j] !== ""));
      const actions = o.actions === undefined || o.actions === null ? [] : list(o.actions, "actions", 0, LIMITS.actions).map((a, i) => sendAction(a, `actions[${i}]`));
      return { kind: "table", columns, numeric, rows, actions };
    },
  },
  chart: {
    fields: ["type", "labels", "values", "unit"],
    read: (o) => {
      const labels = list(o.labels, "labels", LIMITS.points[0], LIMITS.points[1]).map((x, i) => text(x, `labels[${i}]`, LIMITS.chartLabel));
      const values = list(o.values, "values", labels.length, labels.length).map((x, i) => num(x, `values[${i}]`, { min: -1e12, max: 1e12 }));
      return { kind: "chart", type: o.type === undefined ? "line" : oneOf(o.type, "type", ["line", "bar"] as const), labels, values, unit: maybeText(o.unit, "unit", LIMITS.unit) };
    },
  },
  connect: {
    fields: ["app", "text"],
    read: (o) => {
      const app = typeof o.app === "string" ? o.app.trim().toLowerCase() : "";
      if (!app) bad("app", "must name the app");
      return { kind: "connect", app, text: text(o.text, "text", LIMITS.connectText) };
    },
  },
  post_preview: {
    fields: ["brand", "posts"],
    read: (o) => ({
      kind: "post_preview",
      brand: maybeText(o.brand, "brand", LIMITS.title) ?? "",
      posts: list(o.posts, "posts", 1, LIMITS.posts).map((x, i) => {
        const p = `posts[${i}]`;
        const f = fields(x, p, ["approval_id", "network", "text", "when", "image_text", "index"]);
        const network = oneOf(f.network, `${p}.network`, NETWORKS);
        return {
          approval_id: approvalRef(f.approval_id, `${p}.approval_id`),
          network,
          text: text(f.text, `${p}.text`, Math.min(LIMITS.postText, NETWORK_LIMIT[network]), { lines: true }),
          when: maybeText(f.when, `${p}.when`, LIMITS.when),
          image_text: maybeText(f.image_text, `${p}.image_text`, LIMITS.imageText),
          index: f.index === undefined || f.index === null ? 0 : num(f.index, `${p}.index`, { min: 0, max: 24, int: true }),
        };
      }),
    }),
  },
  email_preview: {
    fields: ["approval_id", "to", "subject", "body"],
    read: (o) => ({
      kind: "email_preview",
      approval_id: approvalRef(o.approval_id, "approval_id"),
      to: text(o.to, "to", LIMITS.to),
      subject: text(o.subject, "subject", LIMITS.subject),
      body: text(o.body, "body", LIMITS.body, { lines: true }),
    }),
  },
  goal: {
    fields: ["metric", "lead", "target", "unit", "due", "step"],
    read: (o) => {
      const target = num(o.target, "target", { min: 0.01, max: LIMITS.maxTarget });
      return {
        kind: "goal",
        metric: o.metric === undefined ? "other" : oneOf(o.metric, "metric", METRICS),
        lead: text(o.lead, "lead", LIMITS.lead),
        target,
        unit: text(o.unit, "unit", LIMITS.unit),
        due: day(o.due, "due"),
        step: o.step === undefined || o.step === null ? stepFor(target) : num(o.step, "step", { min: 0.01, max: LIMITS.maxTarget }),
      };
    },
  },
  plan: {
    fields: ["steps", "go"],
    read: (o, agent) => ({
      kind: "plan",
      steps: list(o.steps, "steps", 1, LIMITS.steps).map((x, i) => {
        const p = `steps[${i}]`;
        const f = fields(x, p, ["title", "owner", "agent", "note"]);
        return { title: text(f.title, `${p}.title`, LIMITS.stepTitle), agent: teammate(f.owner ?? f.agent, `${p}.owner`, agent), note: maybeText(f.note, `${p}.note`, LIMITS.stepNote) };
      }),
      go: maybeText(o.go, "go", LIMITS.submit) ?? "Go",
    }),
  },
  progress: {
    fields: ["goal_id", "lead", "target", "unit", "due", "start", "current", "points", "status"],
    read: (o) => ({
      kind: "progress",
      goal_id: text(o.goal_id, "goal_id", 64),
      lead: text(o.lead, "lead", LIMITS.lead),
      target: num(o.target, "target", { min: 0.01, max: LIMITS.maxTarget }),
      unit: text(o.unit, "unit", LIMITS.unit),
      due: day(o.due, "due"),
      start: day(o.start, "start"),
      current: num(o.current, "current", { min: -LIMITS.maxTarget, max: LIMITS.maxTarget }),
      points: (o.points === undefined ? [] : list(o.points, "points", 0, 200)).map((x, i) => {
        const f = fields(x, `points[${i}]`, ["at", "value"]);
        return { at: day(f.at, `points[${i}].at`), value: num(f.value, `points[${i}].value`, { min: -LIMITS.maxTarget, max: LIMITS.maxTarget }) };
      }),
      status: o.status === undefined ? "on_track" : oneOf(o.status, "status", ["on_track", "needs_you", "done"] as const),
    }),
  },
};

/** The fields a kind takes, besides kind, id, title and note. */
export const kindFields = (k: CardKind) => READERS[k].fields;

export type CardCheck = { ok: true; card: Card } | { ok: false; error: string };

/**
 * Checks a card the model (or a goal tool) asked for and returns it ready to show: known kind, known fields only,
 * every limit kept, text cleaned. `agent` is the teammate showing it. A card without an id gets a new one.
 */
export function readCard(input: unknown, agent: AgentKey, o: { kinds?: readonly CardKind[]; id?: () => string } = {}): CardCheck {
  try {
    if (!isObj(input)) bad("card", "must be an object");
    const raw = input as Record<string, unknown>;
    const kind = oneOf(raw.kind, "kind", o.kinds ?? CARD_KINDS);
    const r = READERS[kind];
    const f = fields(raw, kind, [...COMMON, ...r.fields]);
    const id = typeof f.id === "string" && CARD_ID.test(f.id) ? f.id : newCardId(o.id);
    const card = { id, agent, title: maybeText(f.title, "title", LIMITS.title), note: maybeText(f.note, "note", LIMITS.note), ...r.read(f, agent) } as Card;
    if (JSON.stringify(card).length > 60_000) bad(kind, "is too big. Show fewer rows or shorter text");
    return { ok: true, card };
  } catch (e) {
    if (e instanceof Bad) return { ok: false, error: e.message };
    throw e;
  }
}

/** The cards saved on a message (meta.cards), checked again on the way out. Bad ones are dropped. */
export function storedCards(meta: Record<string, unknown> | null | undefined): Card[] {
  const raw = Array.isArray(meta?.cards) ? (meta.cards as unknown[]) : [];
  const out: Card[] = [];
  for (const c of raw.slice(0, LIMITS.cardsPerReply)) {
    const agent = isObj(c) && isAgentKey(c.agent) ? c.agent : "chief";
    const r = readCard(c, agent);
    if (r.ok && isObj(c) && typeof c.id === "string" && r.card.id === c.id) out.push(r.card);
  }
  return out;
}

// ─────────────── what cards send ───────────────

const noMark = (s: string) => s.replace(/[?:.\s]+$/, "");

/** The person's answer to a choices card, as their next message: "Where should we post: LinkedIn. How often: 3 a week." */
export function choicesText(card: Pick<ChoicesCard, "questions">, picks: string[][]): string {
  return card.questions
    .map((q, i) => {
      const got = q.options.filter((x) => (picks[i] ?? []).includes(x));
      return got.length ? `${noMark(q.label)}: ${got.join(", ")}.` : "";
    })
    .filter(Boolean)
    .join(" ");
}

/** The picks in an answer choicesText wrote, so a reloaded card shows what was sent. Empty lists when it doesn't match. */
export function picksFrom(card: Pick<ChoicesCard, "questions">, answer: string): string[][] {
  return card.questions.map((q) => {
    const head = `${noMark(q.label)}: `;
    const at = answer.indexOf(head);
    if (at < 0) return [];
    const rest = answer.slice(at + head.length);
    // The picks run to the next question's start, or the end.
    const next = card.questions.map((x) => rest.indexOf(` ${noMark(x.label)}: `)).filter((n) => n >= 0);
    const part = rest.slice(0, next.length ? Math.min(...next) : undefined).replace(/\.\s*$/, "");
    const said = part.split(", ").map((s) => s.trim());
    return q.options.filter((x) => said.includes(x));
  });
}

/** True when every question has at least one pick, so the card can be sent. */
export const choicesReady = (card: Pick<ChoicesCard, "questions">, picks: string[][]) => card.questions.every((_, i) => (picks[i] ?? []).length > 0);

/** Picking an option: one per question, or several when the question allows it. */
export function togglePick(q: Pick<Question, "multi">, current: string[], option: string): string[] {
  if (!q.multi) return [option];
  return current.includes(option) ? current.filter((x) => x !== option) : [...current, option];
}

// ─────────────── approving from a card ───────────────

/** The request that decides an approval from a card. Always the approvals route, never the product itself. */
export function approvalRequest(workspaceId: string, approvalId: number, action: "approve" | "deny", input?: Record<string, unknown> | null): { path: string; body: Record<string, unknown> } {
  return { path: `/api/approvals/${approvalId}`, body: { workspaceId, action, ...(action === "approve" && input ? { input } : {}) } };
}

const isPostList = (v: unknown): v is Record<string, unknown>[] => Array.isArray(v) && v.every(isObj);

/** The approval's details with one post's words changed (create_posts: posts[index].text, and its own channel words). */
export function postInputWith(input: Record<string, unknown>, index: number, words: string): Record<string, unknown> {
  const posts = isPostList(input.posts) ? input.posts : null;
  if (!posts || !posts[index]) return setPath(input, ["text"], words);
  let next = setPath(input, ["posts", index, "text"], words);
  const own = posts[index].channel_text;
  if (isObj(own)) for (const k of Object.keys(own)) next = setPath(next, ["posts", index, "channel_text", k], words);
  return next;
}

/** The post's words as they will go out: posts[index].text, or a top-level text. */
export function postWords(input: Record<string, unknown> | null | undefined, index = 0): string | null {
  const posts = input && isPostList(input.posts) ? input.posts : null;
  const t = posts ? posts[index]?.text : input?.text;
  return typeof t === "string" ? t : null;
}

const TO_KEYS = ["recipient_email", "to", "to_email", "recipient", "email"];
const SUBJECT_KEYS = ["subject"];
const BODY_KEYS = ["body", "message_body", "message", "text", "content"];
const firstKey = (input: Record<string, unknown>, keys: string[]) => keys.find((k) => typeof input[k] === "string" || Array.isArray(input[k]));

/** An email approval's to, subject and body, from wherever the app's action keeps them. Missing ones are null. */
export function emailWords(input: Record<string, unknown> | null | undefined): { to: string | null; subject: string | null; body: string | null } {
  const get = (keys: string[]) => {
    const k = input ? firstKey(input, keys) : undefined;
    const v = k ? input![k] : null;
    return Array.isArray(v) ? v.filter((x) => typeof x === "string").join(", ") || null : typeof v === "string" && v.trim() ? v : null;
  };
  return { to: get(TO_KEYS), subject: get(SUBJECT_KEYS), body: get(BODY_KEYS) };
}

/** An email approval's details with the edited to, subject and body put where the app's action reads them. */
export function emailInputWith(input: Record<string, unknown>, e: { to: string; subject: string; body: string }): Record<string, unknown> {
  let next = { ...input };
  const to = firstKey(input, TO_KEYS);
  if (to) next = setPath(next, [to], Array.isArray(input[to]) ? e.to.split(/\s*,\s*/).filter(Boolean) : e.to);
  next = setPath(next, [firstKey(input, SUBJECT_KEYS) ?? "subject"], e.subject);
  next = setPath(next, [firstKey(input, BODY_KEYS) ?? "body"], e.body);
  return next;
}

// ─────────────── goals ───────────────

/** A stepper's step for a target: about a sixth of it, on a round number (1, 5, 10, 25, 50, 100, 250, ...). */
export function stepFor(target: number): number {
  const want = Math.max(1, Math.abs(target) / 6);
  for (let k = 0; k < 10; k++) for (const m of k === 0 ? [1, 2, 5] : [1, 2.5, 5]) if (m * 10 ** k >= want) return m * 10 ** k;
  return 1e10;
}

/** A date moved by whole months. The end of a month stays the end of a month (Jan 31, Feb 28, Mar 31). */
export function shiftMonths(dayIso: string, months: number): string {
  const [y, m, d] = dayIso.split("-").map(Number);
  const last = (yy: number, mm: number) => new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
  const wasLast = d === last(y, m - 1);
  const t = new Date(Date.UTC(y, m - 1 + months, 1));
  const ly = t.getUTCFullYear();
  const lm = t.getUTCMonth();
  const dd = wasLast ? last(ly, lm) : Math.min(d, last(ly, lm));
  return `${ly}-${String(lm + 1).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

/** "Jan 31", or "Jan 31, 2028" when it isn't this year or next January to June. */
export function dayLabel(dayIso: string, now = Date.now()): string {
  const d = new Date(`${dayIso}T12:00:00Z`);
  const months = (d.getTime() - now) / (30.4 * 864e5);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC", ...(months > 10 || months < -2 ? { year: "numeric" } : {}) });
}

/** A number as people read it: 1,240 or 12.5. */
export const numLabel = (n: number) => (Number.isInteger(n) ? n.toLocaleString("en-US") : n.toLocaleString("en-US", { maximumFractionDigits: 1 }));

/** "Grow LinkedIn by 150 followers by Jan 31". */
export const goalSentence = (g: { lead: string; target: number; unit: string; due: string }, now = Date.now()) => `${g.lead} ${numLabel(g.target)} ${g.unit} by ${dayLabel(g.due, now)}`;

/** The person's answer to a goal card's Start. */
export const goalStartText = (g: { lead: string; target: number; unit: string; due: string }, now = Date.now()) => `Start the goal: ${goalSentence(g, now)}.`;

/** The person's answer to a plan's Go, naming the steps they kept, in order. */
export const planGoText = (steps: { title: string; agent: AgentKey }[]) =>
  `Go. Run the plan: ${steps.map((s, i) => `${i + 1}. ${s.title.replace(/[.\s]+$/, "")} (${AGENTS[s.agent].god}).`).join(" ")}`;

/** The meter's words: "12 of 150 followers". */
export const meterText = (current: number, target: number, unit: string) => `${numLabel(Math.max(0, current))} of ${numLabel(target)} ${unit}`;
/** How full the meter is, 0 to 100. */
export const meterPercent = (current: number, target: number) => (target > 0 ? Math.max(0, Math.min(100, (current / target) * 100)) : 0);

/**
 * Where a goal stands: Done once the number is reached (or someone marked it done), Needs you when work waits for the
 * owner (an approval in its chat) or it is well behind the straight line from start to due date, else On track.
 * The first week is never behind.
 */
export function goalStatus(g: { status: string; current: number; target: number; created_at: string; due_date: string }, o: { now?: number; pending?: number } = {}): GoalStatus {
  if (g.status === "done" || g.current >= g.target) return "done";
  if ((o.pending ?? 0) > 0) return "needs_you";
  const now = o.now ?? Date.now();
  const start = Date.parse(g.created_at);
  const end = Date.parse(`${g.due_date}T23:59:59Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || now - start < 7 * 864e5) return "on_track";
  const share = Math.min(1, Math.max(0, (now - start) / Math.max(1, end - start)));
  return g.current < g.target * share * 0.75 ? "needs_you" : "on_track";
}

// ─────────────── charts ───────────────

export type ChartBox = { w: number; h: number; left: number; right: number; top: number; bottom: number };
export const CHART_BOX: ChartBox = { w: 640, h: 180, left: 44, right: 12, top: 14, bottom: 26 };

/** The highest and lowest the y axis shows: from 0 (or below, for negatives) to a little over the top value. */
export function chartRange(values: number[], extra: number[] = []): { min: number; max: number } {
  const all = [...values, ...extra].filter(Number.isFinite);
  const min = Math.min(0, ...all);
  const top = Math.max(...all, min + 1);
  return { min, max: top === min ? min + 1 : top };
}

/** Where each value sits in the chart's box, left to right. */
export function chartPoints(values: number[], range: { min: number; max: number }, box: ChartBox = CHART_BOX): { x: number; y: number }[] {
  const iw = box.w - box.left - box.right;
  const ih = box.h - box.top - box.bottom;
  const n = values.length;
  return values.map((v, i) => ({ x: box.left + (n < 2 ? iw / 2 : (iw * i) / (n - 1)), y: box.top + ih - ((v - range.min) / (range.max - range.min)) * ih }));
}

/** A short summary of a chart for screen readers: "Visits by month, from 12,710 in Jun to 2,493 in Nov." */
export function chartSummary(c: Pick<ChartCard, "labels" | "values" | "unit" | "title">): string {
  const u = c.unit ? ` ${c.unit}` : "";
  const first = `${numLabel(c.values[0])}${u} in ${c.labels[0]}`;
  const last = `${numLabel(c.values[c.values.length - 1])}${u} in ${c.labels[c.labels.length - 1]}`;
  return `${c.title ?? "Chart"}: from ${first} to ${last}.`;
}

// ─────────────── cards in words ───────────────

/** One line per card, for the teammate's own history: what the person saw under the reply. */
export function cardsNote(cards: Card[]): string {
  const one = (c: Card): string => {
    switch (c.kind) {
      case "choices":
        return `[Card: choices. ${c.questions.map((q) => `${q.label} (${q.options.join(", ")})`).join(" ")}]`;
      case "quick_replies":
        return `[Card: quick replies. ${c.replies.join(" | ")}]`;
      case "table":
        return `[Card: table${c.title ? ` "${c.title}"` : ""}, ${c.rows.length} rows: ${c.columns.join(", ")}]`;
      case "chart":
        return `[Card: ${c.type} chart${c.title ? ` "${c.title}"` : ""}. ${c.labels.map((l, i) => `${l} ${c.values[i]}`).join(", ")}]`;
      case "connect":
        return `[Card: connect ${c.app}]`;
      case "post_preview":
        return `[Card: post preview. ${c.posts.map((p) => `${NETWORK_NAME[p.network]} post${p.approval_id ? ` (approval #${p.approval_id})` : ""}`).join(", ")}]`;
      case "email_preview":
        return `[Card: email preview to ${c.to}, "${c.subject}"${c.approval_id ? ` (approval #${c.approval_id})` : ""}]`;
      case "goal":
        return `[Card: goal. ${goalSentence(c)}. Waits for Start.]`;
      case "plan":
        return `[Card: plan. ${c.steps.map((s, i) => `${i + 1}. ${s.title} (${AGENTS[s.agent].god})`).join(" ")} Waits for ${c.go}.]`;
      case "progress":
        return `[Card: progress. ${meterText(c.current, c.target, c.unit)}, ${GOAL_STATUS_LABEL[c.status]}.]`;
    }
  };
  return cards.map(one).join("\n");
}
