// Iris's Campaigns tab, the server's part (src/app/api/work/email): approving a campaign schedules it, after checking
// the law's and the inbox's needs, and a test goes to the person first. Drafts are written and canceled straight in
// the database under the campaigns policies (029_campaigns.sql). Pure: the deps come from the route.
import { cleanCampaign, emailFor, footer, type Campaign } from "./campaigns.ts";

type Result = { status: number; body: Record<string, unknown> };
type Gate = (min: "owner" | "admin" | "editor" | "viewer") => Promise<{ ok: true; userId: string; email?: string | null } | { ok: false; status: number; error: string }>;
type App = "gmail" | "outlook";

export const EMAIL_MESSAGES = {
  campaign: "That campaign was not found.",
  notDraft: "Only a draft can be scheduled. Move it back to drafts first.",
  time: "Pick a send time in the next year.",
  address: "Add your mailing address in Iris's Settings first. The law requires it on marketing emails.",
  inbox: "Connect Gmail or Outlook in Settings, Apps first. Campaigns go out from your own inbox.",
  empty: "Nobody on that list can get it yet. Import your contacts in Iris's Settings.",
  noEmail: "We don't know your email to send the test to.",
  action: "That action isn't supported.",
};

export type EmailDeps = {
  gate: Gate;
  campaign: (id: string) => Promise<Pick<Campaign, "id" | "subject" | "body" | "list" | "status"> | null>;
  sender: () => Promise<{ business: string; address: string } | null>;
  inbox: () => Promise<App | null>;
  /** People on the list (or the whole list) who haven't unsubscribed. */
  reachable: (list: string | null) => Promise<number>;
  schedule: (id: string, patch: { status: "scheduled"; send_at: string; from_app: App; approved_by: string }) => Promise<void>;
  send: (app: App, to: string, subject: string, body: string) => Promise<void>;
  unsubscribeUrl: string;
  activity: (text: string) => Promise<void>;
  now?: () => number;
};

/**
 * POST (editors and up):
 *   { action: "schedule", campaignId, sendAt? }   approve a draft: it goes out at sendAt, or now
 *   { action: "test", campaignId }                send it to the person's own email first
 */
export async function emailAct(b: Record<string, unknown>, d: EmailDeps): Promise<Result> {
  const who = await d.gate("editor");
  if (!who.ok) return { status: who.status, body: { error: who.error } };
  const id = typeof b.campaignId === "string" ? b.campaignId : "";
  const c = /^[0-9a-f-]{36}$/i.test(id) ? await d.campaign(id) : null;
  if (!c) return { status: 404, body: { error: EMAIL_MESSAGES.campaign } };
  const words = cleanCampaign(c);
  if (!words.ok) return { status: 400, body: { error: words.error } };
  const [who2, app] = await Promise.all([d.sender(), d.inbox()]);
  if (!who2) return { status: 409, body: { error: EMAIL_MESSAGES.address } };
  if (!app) return { status: 409, body: { error: EMAIL_MESSAGES.inbox } };
  const now = (d.now ?? Date.now)();

  if (b.action === "test") {
    if (!who.email) return { status: 400, body: { error: EMAIL_MESSAGES.noEmail } };
    const email = emailFor({ name: "" }, c, footer(who2.business, who2.address, d.unsubscribeUrl));
    await d.send(app, who.email, `[Test] ${email.subject}`, email.body);
    return { status: 200, body: { ok: true, to: who.email } };
  }
  if (b.action !== "schedule") return { status: 400, body: { error: EMAIL_MESSAGES.action } };
  if (c.status !== "draft") return { status: 409, body: { error: EMAIL_MESSAGES.notDraft } };
  const at = typeof b.sendAt === "string" && !Number.isNaN(Date.parse(b.sendAt)) ? Date.parse(b.sendAt) : now;
  if (at < now - 5 * 60_000 || at > now + 366 * 86_400_000) return { status: 400, body: { error: EMAIL_MESSAGES.time } };
  const people = await d.reachable(c.list);
  if (!people) return { status: 409, body: { error: EMAIL_MESSAGES.empty } };
  await d.schedule(c.id, { status: "scheduled", send_at: new Date(Math.max(at, now)).toISOString(), from_app: app, approved_by: who.userId });
  await d.activity(`You approved the campaign "${c.subject.slice(0, 120)}" for ${people === 1 ? "1 person" : `${people.toLocaleString("en-US")} people`}.`).catch(() => {});
  return { status: 200, body: { ok: true, people } };
}

/** The unsubscribe page, as plain HTML. No sign-in: the link's token is the key. */
export function unsubscribePage(state: "ask" | "done" | "bad", token = ""): string {
  const body =
    state === "ask"
      ? `<h1>Stop getting these emails?</h1><p>You won't get campaign emails from this business again.</p><form method="post"><input type="hidden" name="t" value="${token.replace(/[^0-9a-f]/g, "")}"><button type="submit">Unsubscribe</button></form>`
      : state === "done"
        ? "<h1>You're unsubscribed.</h1><p>You won't get campaign emails from this business again.</p>"
        : "<h1>That link didn't work.</h1><p>It may be old. Reply to the email and ask to be taken off the list.</p>";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Unsubscribe</title><style>body{font:16px/1.5 system-ui,-apple-system,sans-serif;color:#2e2926;background:#fff;max-width:440px;margin:15vh auto;padding:0 16px}h1{font-size:22px;font-weight:600;margin:0 0 8px}p{color:#6e6660}button{font:inherit;margin-top:16px;padding:10px 18px;border:0;border-radius:999px;background:#2e2926;color:#fff;cursor:pointer}</style></head><body>${body}</body></html>`;
}
