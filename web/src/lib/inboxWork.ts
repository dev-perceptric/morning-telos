// Irene's Inbox tab (src/components/Inbox.tsx): the replies she wrote to customers, read from her approvals
// (approvals.ts). Waiting ones are pending approvals the person can edit, send or turn down; sent ones went out from
// the business's own Gmail, Outlook, Zendesk or Help Scout. Members read approvals straight from the database
// (013_approvals.sql). Shared by the browser and the tests.
import { emailWords } from "./cards.ts";
import { appName } from "./composio/catalog.ts";

/** The apps Irene answers customers in. */
export const SUPPORT_APPS = ["gmail", "outlook", "zendesk", "help_scout"] as const;

export type Reply = {
  approvalId: number;
  status: "wait" | "sent" | "failed" | "denied";
  to: string | null;
  subject: string;
  body: string;
  product: string;
  app: string;
  why: string | null;
  at: string;
};

type Row = { id: number; product: string; tool: string; title: string; input: Record<string, unknown> | null; status: string; result: string | null; created_at: string; finished_at: string | null };

const STATUS: Record<string, Reply["status"] | null> = { pending: "wait", approved: "wait", running: "wait", done: "sent", failed: "failed", denied: "denied" };

/** Irene's replies from her approvals. Changes that aren't replies (labels, drafts of other kinds) are left out. */
export function repliesOf(rows: readonly Row[]): Reply[] {
  const out: Reply[] = [];
  for (const r of rows) {
    if (!(SUPPORT_APPS as readonly string[]).includes(r.product)) continue;
    const status = STATUS[r.status];
    if (!status) continue;
    const w = emailWords(r.input);
    if (!w.body) continue;
    out.push({
      approvalId: r.id,
      status,
      to: w.to,
      subject: w.subject?.trim() || r.title,
      body: w.body,
      product: r.product,
      app: appName(r.product),
      why: status === "failed" ? (r.result ?? "").trim().slice(0, 300) || null : null,
      at: r.finished_at ?? r.created_at,
    });
  }
  return out;
}

/** Irene's line at the top of the tab. Null before her first reply. */
export function inboxSummary(replies: readonly Reply[], now = Date.now()): string | null {
  const week = replies.filter((r) => r.status === "sent" && now - Date.parse(r.at) < 7 * 86_400_000).length;
  const waiting = replies.filter((r) => r.status === "wait").length;
  if (!week && !waiting) return null;
  const parts: string[] = [];
  if (week) parts.push(`I answered ${week === 1 ? "1 customer" : `${week} customers`} this week`);
  if (waiting) parts.push(`${waiting === 1 ? "1 reply waits" : `${waiting} replies wait`} for your OK`);
  return `${parts.join(", and ")}.`;
}

/** A question and answer for Knowledge, from a reply the person liked. */
export function faqOf(r: Pick<Reply, "subject" | "body">): { title: string; body: string } {
  const topic = r.subject.replace(/^(re|fw|fwd):\s*/i, "").trim() || "Customer question";
  return { title: `FAQ: ${topic}`.slice(0, 200), body: `Question: ${topic}\n\nAnswer:\n${r.body}` };
}
