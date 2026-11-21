// Artemis's Visibility tab (src/components/Visibility.tsx): the AI questions she tracks in Arrowsterr and the content
// plan, read with the workspace's brand key.
// Each Arrowsterr read uses one of our tasks, and Arrowsterr checks the AI tools once a day, so the tab keeps what it
// read in work_cache (026_work_cache.sql) and reads again at most once a day, or after a change made on the tab.
// Questions and topics Artemis added while on "Ask me first" are pending approvals of add_prompts and
// add_to_content_plan, shown as "waiting". Approving one goes through /api/approvals/<id>.
// Pure: the routes in src/app/api/work/seo pass the database and the product calls in as deps.

type Result = { status: number; body: Record<string, unknown> };
type Gate = (min: "owner" | "admin" | "editor" | "viewer") => Promise<{ ok: true; userId: string } | { ok: false; status: number; error: string }>;

/** The AI tools Arrowsterr asks, in the order the tab shows them. */
export const ENGINES = ["ChatGPT", "Perplexity", "Gemini", "Claude", "AI Overview"] as const;

/** One tracked question. `latest`: each AI tool's latest answer: "#2" (names you second), "not named", or Arrowsterr's word. */
export type Question = { prompt: string; topic: string; visibility: number | null; position: number | null; latest: Record<string, string>; mostNamed: string[]; wait?: { approvalId: number } };
export type Topic = { id: string | null; keyword: string; status: string; volume: number | null; difficulty: number | null; notes: string | null; url: string | null; wait?: { approvalId: number } };
export type Visibility = { visibility: number | null; before: number | null; byModel: { model: string; visibility: number | null }[]; topCompetitor: { name: string; visibility: number | null } | null };
export type SeoData = { visibility: Visibility | null; questions: Question[]; plan: Topic[] };

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** A tool's JSON from Arrowsterr's text answer, which may start with a summary line. Null when there is none. */
export function readJson(text: string | null): Record<string, unknown> | null {
  if (!text) return null;
  const at = text.indexOf("{");
  if (at < 0) return null;
  try {
    const v = JSON.parse(text.slice(at));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function visibilityOf(v: Record<string, unknown> | null): Visibility | null {
  if (!v) return null;
  const top = Array.isArray(v.topCompetitors) ? (v.topCompetitors[0] as Record<string, unknown> | undefined) : undefined;
  return {
    visibility: num(v.visibility),
    before: num(v.visibilityBefore),
    byModel: (Array.isArray(v.byModel) ? v.byModel : []).map((m) => ({ model: str((m as Record<string, unknown>)?.model, 40), visibility: num((m as Record<string, unknown>)?.visibility) })).filter((m) => m.model),
    topCompetitor: top && str(top.name, 120) ? { name: str(top.name, 120), visibility: num(top.visibility) } : null,
  };
}

export function questionsOf(v: Record<string, unknown> | null): Question[] {
  const list = Array.isArray(v?.prompts) ? (v!.prompts as Record<string, unknown>[]) : [];
  return list
    .filter((q) => q && str(q.prompt))
    .map((q) => ({
      prompt: str(q.prompt, 400),
      topic: str(q.topic, 80),
      visibility: num(q.visibility),
      position: num(q.position),
      latest: Object.fromEntries(Object.entries(q.latest && typeof q.latest === "object" ? (q.latest as Record<string, unknown>) : {}).map(([k, x]) => [k, str(x, 40)])),
      mostNamed: (Array.isArray(q.mostNamed) ? q.mostNamed : []).map((x) => str(x, 120)).filter(Boolean).slice(0, 5),
    }));
}

export function planOf(v: Record<string, unknown> | null): Topic[] {
  const list = Array.isArray(v?.items) ? (v!.items as Record<string, unknown>[]) : [];
  return list
    .filter((t) => t && str(t.keyword))
    .map((t) => ({ id: str(t.id, 60) || null, keyword: str(t.keyword, 200), status: str(t.status, 20) || "planned", volume: num(t.volume), difficulty: num(t.difficulty), notes: str(t.notes, 2000) || null, url: str(t.url, 500) || null }));
}

type ApprovalRow = { id: number; tool: string; input: Record<string, unknown> | null; status: string };

/** Artemis's pending questions and topics, from add_prompts and add_to_content_plan approvals. */
export function waitingOf(rows: readonly ApprovalRow[]): { questions: Question[]; plan: Topic[] } {
  const questions: Question[] = [];
  const plan: Topic[] = [];
  for (const r of rows) {
    if (r.status !== "pending" || !r.input) continue;
    if (r.tool === "add_prompts") {
      const topic = str(r.input.topic, 80);
      for (const p of Array.isArray(r.input.prompts) ? r.input.prompts : []) {
        const prompt = str(p, 400);
        if (prompt) questions.push({ prompt, topic, visibility: null, position: null, latest: {}, mostNamed: [], wait: { approvalId: r.id } });
      }
    } else if (r.tool === "add_to_content_plan") {
      for (const it of Array.isArray(r.input.items) ? (r.input.items as Record<string, unknown>[]) : []) {
        const keyword = str(it?.keyword, 200);
        if (keyword) plan.push({ id: null, keyword, status: "planned", volume: num(it.volume), difficulty: num(it.difficulty), notes: str(it.notes, 2000) || null, url: null, wait: { approvalId: r.id } });
      }
    }
  }
  return { questions, plan };
}

/** Artemis's one line at the top of the tab. Null before the first daily check. */
export function seoSummary(v: Visibility | null): string | null {
  if (!v || v.visibility === null) return null;
  let line = `AI tools named you in ${Math.round(v.visibility)}% of answers in the last 30 days`;
  if (v.before !== null && Math.round(v.before) !== Math.round(v.visibility)) line += `, ${v.visibility > v.before ? "up" : "down"} from ${Math.round(v.before)}%`;
  line += ".";
  const best = [...v.byModel].filter((m) => m.visibility !== null && m.visibility > 0).sort((a, b) => b.visibility! - a.visibility!)[0];
  if (best) line += ` ${best.model} names you most.`;
  if (v.topCompetitor?.visibility !== null && v.topCompetitor?.visibility !== undefined) line += ` ${v.topCompetitor.name} shows up in ${Math.round(v.topCompetitor.visibility)}%.`;
  return line;
}

/** True when the saved copy is older than a day and should be read again. */
export const stale = (fetchedAt: string | null, now: number, maxAgeMs = 20 * 3_600_000) => !fetchedAt || now - Date.parse(fetchedAt) > maxAgeMs;

export const SEO_MESSAGES = {
  setup: "Artemis's SEO tools are still setting up. Check back in a few minutes.",
  load: "We couldn't load Artemis's work. Try again.",
  question: "Write the question people ask an AI.",
  questionLong: "Keep the question under 300 characters.",
  full: (max: number) => (max ? `Your plan tracks ${max} questions, and they're all in use. Upgrade to track more.` : "Your plan has ended. Pick a plan to track questions."),
  keyword: "Write the topic's keyword.",
  topic: "That topic was not found.",
  status: "Pick a status.",
  action: "That action isn't supported.",
  failed: "That didn't save. Try again.",
  answers: "We couldn't load the AI answers. Try again.",
};

/** Where questions added from the tab go in Arrowsterr. */
export const TAB_TOPIC = "Your questions";

export type SeoDeps = {
  gate: Gate;
  /** Arrowsterr's status for the workspace ("ready" once its brand key works). */
  serviceStatus: () => Promise<string | null>;
  read: (tool: string, input: Record<string, unknown>) => Promise<string | null>;
  cache: { get: () => Promise<{ data: SeoData; fetchedAt: string } | null>; set: (data: SeoData) => Promise<void>; clear: () => Promise<void> };
  approvals: () => Promise<ApprovalRow[]>;
  /** How many questions the workspace's plan allows. */
  limit: () => Promise<number>;
  now?: () => number;
};

/**
 * Reads Arrowsterr again (3 tasks) and saves it. When every read fails, it's either a brand before its first daily
 * check (Arrowsterr answers "no data yet") or Arrowsterr is down: either way the tab is empty for now, and nothing is
 * saved, so the next visit tries again.
 */
async function fresh(d: SeoDeps): Promise<{ data: SeoData; saved: boolean }> {
  const [v, q, p] = await Promise.all([d.read("get_ai_visibility", { days: 30 }), d.read("get_prompts", { days: 30 }), d.read("get_content_plan", {})]);
  const vis = readJson(v), prompts = readJson(q), plan = readJson(p);
  const data: SeoData = { visibility: visibilityOf(vis), questions: questionsOf(prompts), plan: planOf(plan) };
  if (!vis && !prompts && !plan) return { data, saved: false };
  await d.cache.set(data);
  return { data, saved: true };
}

/** GET: the tab (viewers and up). */
export async function seoWork(d: SeoDeps): Promise<Result> {
  const who = await d.gate("viewer");
  if (!who.ok) return { status: who.status, body: { error: who.error } };
  const [status, approvals, limit] = await Promise.all([d.serviceStatus(), d.approvals(), d.limit()]);
  const waiting = waitingOf(approvals);
  const pending = approvals.filter((a) => a.status === "pending").map((a) => ({ id: a.id, tool: a.tool }));
  const base = { approvals: pending, limit };
  if (status !== "ready") return { status: 200, body: { ...base, ready: false, questions: waiting.questions, plan: waiting.plan, summary: null, fetchedAt: null } };
  const now = (d.now ?? Date.now)();
  const saved = await d.cache.get();
  let data: SeoData;
  let fetchedAt: string | null;
  if (saved && !stale(saved.fetchedAt, now)) {
    data = saved.data;
    fetchedAt = saved.fetchedAt;
  } else {
    const f = await fresh(d);
    if (f.saved) {
      data = f.data;
      fetchedAt = new Date(now).toISOString();
    } else if (saved) {
      // A failed read keeps showing yesterday's copy rather than nothing.
      data = saved.data;
      fetchedAt = saved.fetchedAt;
    } else {
      data = f.data;
      fetchedAt = null;
    }
  }
  return {
    status: 200,
    body: { ...base, ready: true, questions: [...data.questions, ...waiting.questions], plan: [...data.plan, ...waiting.plan], visibility: data.visibility, summary: seoSummary(data.visibility), fetchedAt },
  };
}

/** GET ?prompt=: each AI tool's latest full answer for one question (1 task). */
export async function seoAnswers(prompt: unknown, d: Pick<SeoDeps, "gate" | "read">): Promise<Result> {
  const who = await d.gate("viewer");
  if (!who.ok) return { status: who.status, body: { error: who.error } };
  const p = str(prompt, 400);
  if (!p) return { status: 400, body: { error: SEO_MESSAGES.question } };
  const out = readJson(await d.read("get_prompt_answers", { prompt: p }));
  if (!out) return { status: 502, body: { error: SEO_MESSAGES.answers } };
  const answers = (Array.isArray(out.answers) ? (out.answers as Record<string, unknown>[]) : []).map((a) => ({
    model: str(a.model, 40),
    rank: num(a.brandRank),
    named: (Array.isArray(a.brandsNamed) ? a.brandsNamed : []).map((x) => str(x, 160)).filter(Boolean).slice(0, 8),
    sites: (Array.isArray(a.sitesCited) ? a.sitesCited : []).map((x) => str(x, 500)).filter(Boolean).slice(0, 8),
    text: str(a.text, 1500) || null,
  }));
  return { status: 200, body: { prompt: str(out.prompt, 400) || p, answers } };
}

export type SeoActDeps = {
  gate: Gate;
  write: (tool: string, input: Record<string, unknown>) => Promise<{ ok: boolean; text: string }>;
  /** Questions tracked now, to keep inside the plan's limit. */
  tracked: () => Promise<number>;
  limit: () => Promise<number>;
  clearCache: () => Promise<void>;
  activity: (text: string) => Promise<void>;
};

const STATUSES = ["planned", "writing", "review", "published"];

/**
 * POST: a change the person makes on the tab (editors and up). Runs in Arrowsterr right away, then the saved copy is
 * cleared so the next visit reads it again.
 *   { action: "track", question }   start tracking a question, inside the plan's limit
 *   { action: "add_topic", keyword, notes? }   add a topic to the content plan
 *   { action: "status", id, status }   move a topic (Write this sets "writing")
 *   { action: "remove_topic", id }   remove a topic from the plan
 */
export async function seoAct(b: Record<string, unknown>, d: SeoActDeps): Promise<Result> {
  const who = await d.gate("editor");
  if (!who.ok) return { status: who.status, body: { error: who.error } };
  let tool: string, input: Record<string, unknown>, did: string;
  if (b.action === "track") {
    const q = typeof b.question === "string" ? b.question.trim() : "";
    if (!q) return { status: 400, body: { error: SEO_MESSAGES.question } };
    if (q.length > 300) return { status: 400, body: { error: SEO_MESSAGES.questionLong } };
    const [used, max] = await Promise.all([d.tracked(), d.limit()]);
    if (used >= max) return { status: 409, body: { error: SEO_MESSAGES.full(max) } };
    tool = "add_prompts";
    input = { topic: TAB_TOPIC, prompts: [q] };
    did = "started tracking a question";
  } else if (b.action === "add_topic") {
    const keyword = str(b.keyword, 200);
    if (!keyword) return { status: 400, body: { error: SEO_MESSAGES.keyword } };
    const notes = str(b.notes, 2000);
    tool = "add_to_content_plan";
    input = { items: [{ keyword, ...(notes ? { notes } : {}) }] };
    did = "added a topic to the content plan";
  } else if (b.action === "status") {
    const id = str(b.id, 60);
    if (!id) return { status: 400, body: { error: SEO_MESSAGES.topic } };
    if (typeof b.status !== "string" || !STATUSES.includes(b.status)) return { status: 400, body: { error: SEO_MESSAGES.status } };
    tool = "update_content_plan";
    input = { items: [{ id, status: b.status }] };
    did = `moved a topic to ${b.status}`;
  } else if (b.action === "remove_topic") {
    const id = str(b.id, 60);
    if (!id) return { status: 400, body: { error: SEO_MESSAGES.topic } };
    tool = "remove_from_content_plan";
    input = { ids: [id] };
    did = "removed a topic from the content plan";
  } else return { status: 400, body: { error: SEO_MESSAGES.action } };
  const r = await d.write(tool, input);
  if (!r.ok) return { status: 502, body: { error: r.text || SEO_MESSAGES.failed } };
  await d.clearCache().catch(() => {});
  await d.activity(`You ${did}.`).catch(() => {});
  return { status: 200, body: { ok: true } };
}
