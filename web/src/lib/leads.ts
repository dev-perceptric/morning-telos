// Midas's leads: the list he keeps for a business with no CRM (028_leads.sql). Shared by the Leads tab
// (src/components/Leads.tsx), his save_lead and find_leads tools (src/lib/leadTools.ts) and the tests.
import { emailWords } from "./cards.ts";

export type Stage = "open" | "won" | "lost";
export type Lead = {
  id: string;
  name: string;
  company: string;
  email: string | null;
  phone: string | null;
  value: number | null;
  stage: Stage;
  next_step: string;
  next_date: string | null;
  last_contact: string | null;
  notes: string;
  /** "hermes" means Midas wrote it: the value is from before the team was renamed, and 028_leads.sql only allows it. */
  source: "person" | "hermes";
  created_at: string;
  updated_at: string;
};
export const LEAD_COLUMNS = "id, name, company, email, phone, value, stage, next_step, next_date, last_contact, notes, source, created_at, updated_at";
export const STAGES: Stage[] = ["open", "won", "lost"];

/** The fields a person or Midas may set, checked. */
export type LeadFields = { name: string; company: string; email: string | null; phone: string | null; value: number | null; stage: Stage; next_step: string; next_date: string | null; notes: string };

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Checks what came in. `partial` (a change to a saved lead) keeps fields that weren't sent. */
export function cleanLead(v: Record<string, unknown>, partial = false): { ok: true; value: Partial<LeadFields> } | { ok: false; error: string } {
  const out: Partial<LeadFields> = {};
  if (!partial || "name" in v) {
    const name = str(v.name, 120);
    if (!name) return { ok: false, error: "Give the lead's name." };
    out.name = name;
  }
  if ("company" in v) out.company = str(v.company, 120);
  if ("email" in v) {
    const email = str(v.email, 200).toLowerCase();
    if (email && !EMAIL.test(email)) return { ok: false, error: "That email doesn't look right." };
    out.email = email || null;
  }
  if ("phone" in v) out.phone = str(v.phone, 40) || null;
  if ("value" in v) {
    const raw = typeof v.value === "string" ? v.value.replace(/[$,\s]/g, "") : v.value;
    if (raw === "" || raw === null || raw === undefined) out.value = null;
    else {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0 || n > 100_000_000) return { ok: false, error: "Give the deal value as a number." };
      out.value = Math.round(n * 100) / 100;
    }
  }
  if ("stage" in v) {
    if (!STAGES.includes(v.stage as Stage)) return { ok: false, error: "The stage is open, won or lost." };
    out.stage = v.stage as Stage;
  }
  if ("next_step" in v) out.next_step = str(v.next_step, 200);
  if ("next_date" in v) {
    const d = str(v.next_date, 10);
    if (d && !DAY.test(d)) return { ok: false, error: "Give the next date as YYYY-MM-DD." };
    out.next_date = d || null;
  }
  if ("notes" in v) out.notes = str(v.notes, 4000);
  return { ok: true, value: out };
}

/** Midas's line at the top of the Leads tab. Null with no open leads and nothing waiting. */
export function leadsSummary(leads: readonly Pick<Lead, "stage" | "value">[], waiting: number): string | null {
  const open = leads.filter((l) => l.stage === "open");
  if (!open.length && !waiting) return null;
  const worth = open.reduce((s, l) => s + (l.value ?? 0), 0);
  const parts = [`${open.length === 1 ? "1 open deal" : `${open.length} open deals`}${worth ? ` worth $${worth.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : ""}`];
  if (waiting) parts.push(`${waiting === 1 ? "1 follow-up waits" : `${waiting} follow-ups wait`} for your OK`);
  return `${parts.join(", and ")}.`;
}

/** Midas's emails waiting for the person's OK, by the address they go to. */
export function followupsByEmail(rows: readonly { id: number; product: string; input: Record<string, unknown> | null; status: string }[]): Map<string, { approvalId: number; to: string; subject: string | null; body: string | null; input: Record<string, unknown> }[]> {
  const out = new Map<string, { approvalId: number; to: string; subject: string | null; body: string | null; input: Record<string, unknown> }[]>();
  for (const r of rows) {
    if (r.status !== "pending" || !r.input || (r.product !== "gmail" && r.product !== "outlook")) continue;
    const w = emailWords(r.input);
    if (!w.to || !w.body) continue;
    for (const to of w.to.split(/\s*,\s*/).map((x) => x.toLowerCase()).filter(Boolean)) {
      out.set(to, [...(out.get(to) ?? []), { approvalId: r.id, to, subject: w.subject, body: w.body, input: r.input }]);
    }
  }
  return out;
}
