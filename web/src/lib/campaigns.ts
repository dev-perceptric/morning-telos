// Iris's email campaigns (029_campaigns.sql): the mailing list, the campaign's words, the footer every email gets, and
// how many may go out from an inbox in a day. Shared by the Campaigns tab (src/components/Campaigns.tsx), the sender
// (src/lib/campaignSend.ts), Iris's tools (src/lib/campaignTools.ts) and the tests.

export type CampaignStatus = "draft" | "scheduled" | "sending" | "sent" | "canceled";
export type Campaign = {
  id: string;
  subject: string;
  body: string;
  list: string | null;
  status: CampaignStatus;
  send_at: string | null;
  from_app: "gmail" | "outlook" | null;
  sent_count: number;
  failed_count: number;
  source: "person" | "iris";
  created_at: string;
  updated_at: string;
};
export const CAMPAIGN_COLUMNS = "id, subject, body, list, status, send_at, from_app, sent_count, failed_count, source, created_at, updated_at";
export type Contact = { id: string; email: string; name: string; list: string; unsubscribed_at: string | null };

/**
 * Emails a day from one inbox. Gmail allows about 500 (2,000 on Google Workspace) and Outlook.com about 300; we stay
 * well under so the business's own mail still goes out and the inbox isn't flagged.
 */
export const DAILY_LIMIT: Record<"gmail" | "outlook", number> = { gmail: 400, outlook: 250 };
/** Emails per worker run (each minute), so a big list goes out over the day instead of all at once. */
export const PER_RUN = 20;
export const DEFAULT_LIST = "Customers";

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** A campaign's words and list, checked. */
export function cleanCampaign(v: Record<string, unknown>): { ok: true; value: { subject: string; body: string; list: string | null } } | { ok: false; error: string } {
  const subject = str(v.subject, 200);
  if (!subject) return { ok: false, error: "Write the subject." };
  const body = typeof v.body === "string" ? v.body.trim() : "";
  if (!body) return { ok: false, error: "Write the email." };
  if (body.length > 20000) return { ok: false, error: "Keep the email under 20,000 characters." };
  const list = str(v.list, 60) || null;
  return { ok: true, value: { subject, body, list } };
}

/** One CSV line into fields, with "quoted, values" and "" for a quote. */
function fields(line: string): string[] {
  const out: string[] = [];
  let cur = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === "," || c === ";" || c === "\t") {
      out.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

/**
 * Contacts from a CSV the person uploads: a header row naming an email column (and maybe name and list), or plain rows
 * where the email is whichever field has an @. Bad and repeated emails are counted, not kept.
 */
export function parseContacts(text: string, list = DEFAULT_LIST): { rows: { email: string; name: string; list: string }[]; bad: number } {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { rows: [], bad: 0 };
  const head = fields(lines[0]).map((h) => h.toLowerCase());
  const at = (names: string[]) => head.findIndex((h) => names.some((n) => h === n || h.replace(/[\s_-]/g, "") === n.replace(/[\s_-]/g, "")));
  const ei = at(["email", "e-mail", "email address", "mail"]);
  const ni = at(["name", "full name", "first name", "first_name"]);
  const li = at(["list", "tag", "group", "segment"]);
  const hasHead = ei >= 0;
  const seen = new Set<string>();
  const rows: { email: string; name: string; list: string }[] = [];
  let bad = 0;
  for (const line of hasHead ? lines.slice(1) : lines) {
    const f = fields(line);
    const email = (hasHead ? f[ei] : f.find((x) => x.includes("@")))?.toLowerCase().trim() ?? "";
    if (!EMAIL.test(email) || email.length > 200 || seen.has(email)) {
      bad++;
      continue;
    }
    seen.add(email);
    const name = (hasHead && ni >= 0 ? f[ni] : hasHead ? "" : f.find((x) => x && !x.includes("@"))) ?? "";
    const own = hasHead && li >= 0 ? (f[li] ?? "").trim() : "";
    rows.push({ email, name: name.slice(0, 120), list: (own || list).slice(0, 60) });
  }
  return { rows, bad };
}

/** {{first_name}} and {{name}} from the contact, so each email starts with their name. */
export function fillIn(text: string, c: Pick<Contact, "name">): string {
  const name = c.name.trim();
  const first = name.split(/\s+/)[0] ?? "";
  return text.replace(/\{\{\s*first_name\s*\}\}/gi, first || "there").replace(/\{\{\s*name\s*\}\}/gi, name || "there");
}

/** What ends every campaign email: who it's from, their mailing address, and how to stop getting them. */
export function footer(business: string, address: string, unsubscribeUrl: string): string {
  return `\n\n--\n${business}\n${address.trim()}\nYou're getting this because you're on ${business}'s list. Unsubscribe: ${unsubscribeUrl}`;
}

/** The email one contact gets. */
export function emailFor(c: Pick<Contact, "name">, campaign: Pick<Campaign, "subject" | "body">, foot: string): { subject: string; body: string } {
  return { subject: fillIn(campaign.subject, c), body: `${fillIn(campaign.body, c)}${foot}` };
}

/** How many may go out on this run: the run's share, inside what's left of the inbox's day. */
export function batchSize(app: "gmail" | "outlook", sentToday: number, perRun = PER_RUN): number {
  return Math.max(0, Math.min(perRun, DAILY_LIMIT[app] - sentToday));
}

/** A mailing address good enough for the footer: a few words on at least one line, like a street and a city. */
export function cleanAddress(v: unknown): string | null {
  const a = typeof v === "string" ? v.trim().slice(0, 300) : "";
  return a.length >= 8 && /\d/.test(a) ? a : null;
}

/** Iris's line at the top of the tab. */
export function campaignsSummary(campaigns: readonly Pick<Campaign, "status" | "sent_count">[], contacts: number): string | null {
  const last = campaigns.find((c) => c.status === "sent");
  const scheduled = campaigns.filter((c) => c.status === "scheduled" || c.status === "sending").length;
  if (!contacts && !campaigns.length) return null;
  const parts = [`${contacts === 1 ? "1 person" : `${contacts.toLocaleString("en-US")} people`} on your list`];
  if (scheduled) parts.push(`${scheduled === 1 ? "1 campaign" : `${scheduled} campaigns`} going out`);
  if (last) parts.push(`the last one went to ${last.sent_count.toLocaleString("en-US")}`);
  return `${parts.join(", ")}.`;
}
