// Approvals: a change an agent wants to make in Arrowsterr or Capybaroar waits here until an editor says yes.
// Ported from the old app (app/lib/agents.js isWrite and the approvals routes in app/server.js) and shaped like
// Omniscient's confirm cards (src/lib/askActions.ts): the tool checks the request and saves a card, and only the
// person's click runs the change.
//
// Pure: the database and the product call come in as deps. The route is src/app/api/approvals/[id]/route.ts and the
// table is supabase/013_approvals.sql. Shared with the screens (no server-only imports).
import type { AgentKey } from "./team.ts";

export type ApprovalStatus = "pending" | "approved" | "denied" | "running" | "done" | "failed";
export const APPROVAL_STATUSES: readonly ApprovalStatus[] = ["pending", "approved", "denied", "running", "done", "failed"];
/** Waiting for a person, or decided and not finished yet. */
export const OPEN_STATUSES: readonly ApprovalStatus[] = ["pending", "approved", "running"];

export type Approval = {
  id: number;
  workspace_id: string;
  thread_id: string | null;
  agent: AgentKey;
  /** Where it runs: "arrowsterr" or "capybaroar" for now. */
  product: string;
  /** The product's own tool name, like "create_posts". */
  tool: string;
  input: Record<string, unknown>;
  title: string;
  why: string;
  status: ApprovalStatus;
  result: string | null;
  decided_by: string | null;
  created_at: string;
  decided_at: string | null;
  finished_at: string | null;
};
export type NewApproval = Pick<Approval, "workspace_id" | "thread_id" | "agent" | "product" | "tool" | "input" | "title" | "why">;

// ─────────────── what counts as a change ───────────────

/** Verbs that mean a tool changes something. The old app's list, plus a few more. */
export const WRITE_VERBS = new Set([
  "add", "approve", "archive", "book", "cancel", "connect", "create", "delete", "disconnect", "duplicate", "edit", "enroll",
  "fire", "generate", "import", "invite", "merge", "move", "pause", "post", "publish", "remove", "replace", "reply",
  "reschedule", "resume", "run", "save", "schedule", "send", "set", "start", "stop", "submit", "test", "trigger",
  "unsubscribe", "update", "upload", "write",
]);

/**
 * True when a tool changes something. The server's annotations decide first: readOnlyHint true is a read, and
 * readOnlyHint false or destructiveHint true is a change. Without them, the first word of the name decides
 * ("create_posts" changes, "get_post" reads).
 */
export function isWrite(tool: { name: string; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean } | null }): boolean {
  const a = tool.annotations ?? {};
  if (a.readOnlyHint === true) return false;
  if (a.readOnlyHint === false || a.destructiveHint === true) return true;
  return WRITE_VERBS.has(String(tool.name).split(/[_\-.\s]/)[0].toLowerCase());
}

// ─────────────── words ───────────────

export const APPROVAL_MESSAGES = {
  saved: (id: number) => `Saved for the owner's approval as #${id}. It has not run yet. Do not call it again.`,
  notFound: "That approval was not found.",
  handled: "This one was already handled.",
  badAction: "Pick approve or deny.",
  badInput: "The edited details must be a set of fields.",
  tooBig: "The edited details are too long.",
  note: {
    done: (title: string) => `Approved and done: ${title}`,
    failed: (title: string) => `Approved, but it didn't work: ${title}`,
    denied: (title: string) => `Not approved: ${title}`,
  },
  stopped: "This stopped before it finished, so we don't know if it ran. Check before you try again.",
} as const;

/** The status as people read it. */
export const STATUS_LABEL: Record<ApprovalStatus, string> = {
  pending: "Needs you",
  approved: "Approved",
  running: "Running",
  denied: "Not approved",
  done: "Done",
  failed: "Didn't work",
};

/** "create_posts" as "Create posts". */
export function toolTitle(name: string, title?: string | null): string {
  const t = (title?.trim() || name.replace(/[_-]+/g, " ")).trim();
  return t ? t[0].toUpperCase() + t.slice(1) : "A change";
}

/** A field name as a label: "publish_at" as "Publish at". */
export const fieldLabel = (key: string) => toolTitle(key);

// ─────────────── checking a decision ───────────────

/** Edited details may be at most this long, as JSON. */
export const MAX_INPUT_CHARS = 50_000;
/** What is kept of a product's answer. */
export const MAX_RESULT_CHARS = 20_000;
/** A decided call still running after this long was cut off (the server restarted, or it hung). */
export const STALE_AFTER = "10 minutes";

export type Decision = { action: "approve"; input: Record<string, unknown> | null } | { action: "deny" };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Checks the body of POST /api/approvals/:id. `input` is optional and replaces the saved details when given. */
export function readDecision(body: Record<string, unknown>): { ok: true; value: Decision } | { ok: false; error: string } {
  if (body.action === "deny") return { ok: true, value: { action: "deny" } };
  if (body.action !== "approve") return { ok: false, error: APPROVAL_MESSAGES.badAction };
  if (body.input === undefined || body.input === null) return { ok: true, value: { action: "approve", input: null } };
  if (!isObject(body.input)) return { ok: false, error: APPROVAL_MESSAGES.badInput };
  if (JSON.stringify(body.input).length > MAX_INPUT_CHARS) return { ok: false, error: APPROVAL_MESSAGES.tooBig };
  return { ok: true, value: { action: "approve", input: body.input } };
}

/** An approval id from the address: a whole number above 0. */
export function approvalId(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d{1,15}$/.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Text cut to `max` letters, saying how much was left out. */
export function clip(text: string, max: number): string {
  const s = String(text ?? "");
  return s.length > max ? `${s.slice(0, max)}\n...(${(s.length - max).toLocaleString("en-US")} more characters left out)` : s;
}

// ─────────────── deciding ───────────────

export type RunResult = { ok: boolean; text: string };
export type DecideDeps = {
  /** The approval, only if it is in this workspace. */
  load: (id: number) => Promise<Approval | null>;
  /**
   * Moves a pending approval to running (approve, with the details that will run) or denied, in one step, and records
   * who decided. Null when it wasn't pending any more (someone else got there first).
   */
  claim: (id: number, by: string, d: Decision) => Promise<Approval | null>;
  /** Runs the change with the workspace's brand key, after checking it is still allowed. */
  run: (ap: Approval) => Promise<RunResult>;
  /** Saves how it went: running becomes done or failed. */
  finish: (id: number, status: "done" | "failed", result: string) => Promise<void>;
  /** A short line back in the chat the approval came from. */
  note: (ap: Approval, text: string, status: ApprovalStatus) => Promise<void>;
  activity: (ap: Approval, text: string) => Promise<void>;
  log?: (message: string) => void;
};

export type DecideOutcome = { status: number; body: { error?: string; status?: ApprovalStatus; result?: string } };

/**
 * Approve or deny one approval for a person who may decide (the route checks the role first). Approving runs the
 * change right away and saves the result. A second decision on the same approval is refused, even at the same moment.
 */
export async function decide(id: number, by: string, d: Decision, deps: DecideDeps): Promise<DecideOutcome> {
  const found = await deps.load(id);
  if (!found) return { status: 404, body: { error: APPROVAL_MESSAGES.notFound } };
  if (found.status !== "pending") return { status: 409, body: { error: APPROVAL_MESSAGES.handled, status: found.status } };
  const ap = await deps.claim(id, by, d);
  if (!ap) return { status: 409, body: { error: APPROVAL_MESSAGES.handled } };
  const quiet = async (what: string, p: Promise<void>) => {
    try {
      await p;
    } catch (e) {
      deps.log?.(`Approval ${id}: ${what} wasn't saved: ${String((e as Error)?.message ?? e).slice(0, 300)}`);
    }
  };

  if (d.action === "deny") {
    await quiet("the chat note", deps.note(ap, APPROVAL_MESSAGES.note.denied(ap.title), "denied"));
    await quiet("the activity line", deps.activity(ap, `prepared a change that was not approved: ${ap.title}`));
    return { status: 200, body: { status: "denied" } };
  }

  let out: RunResult;
  try {
    out = await deps.run(ap);
  } catch (e) {
    out = { ok: false, text: String((e as Error)?.message ?? e) };
  }
  const status = out.ok ? "done" : "failed";
  const result = clip(out.text || (out.ok ? "Done." : "It didn't work."), MAX_RESULT_CHARS);
  try {
    await deps.finish(id, status, result);
  } catch (e) {
    // It ran, but the result wasn't saved. The stale sweep marks it so a person checks before trying again.
    deps.log?.(`Approval ${id} ran (${status}) but its result wasn't saved: ${String((e as Error)?.message ?? e).slice(0, 300)}`);
  }
  await quiet("the chat note", deps.note(ap, status === "done" ? APPROVAL_MESSAGES.note.done(ap.title) : APPROVAL_MESSAGES.note.failed(ap.title), status));
  await quiet("the activity line", deps.activity(ap, `${status === "done" ? "finished" : "couldn't finish"}: ${ap.title}`));
  return { status: 200, body: { status, result: clip(result, 4000) } };
}

// ─────────────── editing the details ───────────────

export type Path = (string | number)[];

/** A copy of `value` with the field at `path` set to `next`. The rest is shared, not copied. */
export function setPath<T>(value: T, path: Path, next: unknown): T {
  if (!path.length) return next as T;
  const [head, ...rest] = path;
  if (Array.isArray(value)) {
    const copy = [...value];
    copy[head as number] = setPath(copy[head as number], rest, next);
    return copy as T;
  }
  const obj = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return { ...obj, [head]: setPath(obj[head as string], rest, next) } as T;
}
