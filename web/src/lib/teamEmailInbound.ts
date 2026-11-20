// The email door's two steps (src/lib/teamEmail.ts says what it is):
//   handleInbound      POST /api/email/inbound. Resend calls it for every email to the receiving domain. Checks the
//                      signature, finds the workspace by the address and the sender by the From line, and queues one
//                      team_email job. It answers in milliseconds, so Resend never times out.
//   processTeamEmail   the worker's team_email job. Reads the whole email, checks it really came from that sender,
//                      finds or starts its chat, saves the person's words, runs the team's turn and emails the answer.
// Anything that isn't for a workspace, or isn't from someone it accepts, gets no reply. Only a count per day and
// reason is kept (team_email_drops), never the address or the text.
// Pure: the database, Resend and the turn come in as deps. The server's are in src/lib/teamEmailServer.ts.
import type { ChatEvent } from "./agentLoop.ts";
import { wordsFor, type StoredFile } from "./attachments.ts";
import type { Email } from "./emailKit.ts";
import type { ReceivedEmail } from "./email.ts";
import { emailText, trimEmail } from "./emailText.ts";
import type { JobResult } from "./jobs.ts";
import { verifyWebhook } from "./standardWebhooks.ts";
import type { AgentKey } from "./team.ts";
import {
  addressOf,
  authPassed,
  cleanSubject,
  EMAILS_PER_HOUR,
  emailThreadTitle,
  findTeamAddress,
  isAutomatic,
  isForward,
  newThreadToken,
  pickThread,
  replyIds,
  routingText,
  senderVerdict,
  teamAddress,
  type DropReason,
  type SenderRow,
  type StoredEmail,
} from "./teamEmail.ts";
import { replyFrom, replyHeaders, teamReplyEmail, type ReplyApproval } from "./teamEmailReply.ts";

export type Result = { status: number; body: Record<string, unknown> };

export type InboundDeps = {
  /** TEAM_EMAIL_DOMAIN. Null means the door is off and the route answers 404. */
  domain: string | null;
  /** RESEND_INBOUND_SECRET, the webhook's signing secret (whsec_...). */
  secret: string | undefined;
  now?: number;
  /** The workspace with this address. */
  findAddress: (slug: string) => Promise<{ workspace_id: string; enabled: boolean } | null>;
  /** team_email_sender(): a member with their role, an extra sender, or null. */
  sender: (workspaceId: string, email: string) => Promise<SenderRow | null>;
  /** queue_team_email(): true when this call queued the job, false when it was already queued. */
  queue: (emailId: string, workspaceId: string) => Promise<boolean>;
  /** count_team_email_drop(). Never throws to the caller. */
  drop: (reason: DropReason) => Promise<void>;
};

type Payload = { type?: unknown; data?: { email_id?: unknown; from?: unknown; to?: unknown; cc?: unknown; received_for?: unknown } };
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const ok = (body: Record<string, unknown> = {}): Result => ({ status: 200, body: { ok: true, ...body } });

/** POST /api/email/inbound. A drop still answers 200, so Resend doesn't send it again. */
export async function handleInbound(req: { headers: Headers; body: string }, d: InboundDeps): Promise<Result> {
  if (!d.domain) return { status: 404, body: { error: "Not found." } };
  if (!verifyWebhook(req.headers, req.body, d.secret, d.now)) return { status: 401, body: { error: "Bad or missing signature." } };
  let p: Payload;
  try {
    p = JSON.parse(req.body) as Payload;
  } catch {
    return { status: 400, body: { error: "Bad body." } };
  }
  if (p?.type !== "email.received") return ok({ ignored: true });
  const data = p.data ?? {};
  const emailId = typeof data.email_id === "string" && /^[A-Za-z0-9-]{1,100}$/.test(data.email_id) ? data.email_id : null;
  if (!emailId) return { status: 400, body: { error: "Bad body." } };
  const dropped = async (reason: DropReason) => {
    await d.drop(reason).catch(() => {});
    return ok({ dropped: true });
  };

  const to = findTeamAddress([list(data.to), list(data.cc), list(data.received_for)], d.domain);
  if (!to) return dropped("unknown_address");
  const where = await d.findAddress(to.slug);
  if (!where) return dropped("unknown_address");
  if (!where.enabled) return dropped("off");
  const from = addressOf(data.from);
  if (!from) return dropped("unknown_sender");
  // Our own answers coming back (a forwarding rule, an auto reply) would start a loop.
  if (from.endsWith(`@${d.domain}`)) return dropped("loop");
  const v = senderVerdict(await d.sender(where.workspace_id, from));
  if (!v.ok) return dropped(v.reason);
  const queued = await d.queue(emailId, where.workspace_id);
  return ok({ queued });
}

// ─────────────── the job ───────────────

export type JobDeps = {
  domain: string;
  appUrl: string;
  now: () => number;
  getEmail: (id: string) => Promise<ReceivedEmail>;
  /** The workspace's address. */
  address: (workspaceId: string) => Promise<{ slug: string; enabled: boolean } | null>;
  sender: (workspaceId: string, email: string) => Promise<SenderRow | null>;
  /** How many emails this workspace received since a time. */
  inboundSince: (workspaceId: string, since: string) => Promise<number>;
  drop: (reason: DropReason) => Promise<void>;
  /** An email chat of this workspace by its token. */
  threadByToken: (workspaceId: string, token: string) => Promise<{ thread_id: string; token: string } | null>;
  /** The chats of this workspace that these Message-IDs belong to, by id. */
  threadsByMessageIds: (workspaceId: string, ids: string[]) => Promise<Record<string, string>>;
  /** The token of an email chat. */
  tokenOf: (workspaceId: string, threadId: string) => Promise<string | null>;
  /** Makes the chat (threads) and its email row (team_email_threads). */
  startThread: (workspaceId: string, t: { id: string; title: string; subject: string; token: string; createdBy: string | null }) => Promise<void>;
  /** Saves a Message-ID for the chat. False when this workspace already has it (the email was already handled). */
  recordMessage: (workspaceId: string, threadId: string, messageId: string, direction: "in" | "out") => Promise<boolean>;
  /** The chat's Message-IDs, oldest first. */
  references: (workspaceId: string, threadId: string) => Promise<string[]>;
  saveMessage: (workspaceId: string, threadId: string, content: string, meta: Record<string, unknown>) => Promise<void>;
  /**
   * Keeps the email's images and PDFs as chat files (pickAttachments, src/lib/attachmentsServer.ts saveFile), so the
   * team reads them like files attached in the app. Returns the saved files and the names of the ones left out.
   */
  saveAttachments: (workspaceId: string, emailId: string) => Promise<{ files: StoredFile[]; skipped: string[] }>;
  /** Runs the team's turn on this chat. Every change waits for approval (capTrust). */
  runTurn: (workspaceId: string, threadId: string, text: string, emit: (e: ChatEvent) => void) => Promise<void>;
  /** Saves an Approve link for this member and returns its address (src/lib/approveLink.ts). */
  approveLink: (workspaceId: string, approvalId: number, userId: string) => Promise<string>;
  send: (to: string, mail: Email, o: { from: string; replyTo: string; headers: Record<string, string>; idempotencyKey: string }) => Promise<void>;
  newId: () => string;
  log: (message: string) => void;
};

const HOUR = 3_600_000;

/** The worker's team_email job. A hiccup reading the email is tried again; once the words are saved it never runs twice. */
export async function processTeamEmail(job: { workspace_id: string | null; payload: Record<string, unknown> }, d: JobDeps): Promise<JobResult> {
  const ws = job.workspace_id;
  const emailId = typeof job.payload.email_id === "string" ? job.payload.email_id : "";
  if (!ws || !emailId) return { status: "failed", error: "A team_email job needs a workspace and an email id." };
  const drop = async (reason: DropReason): Promise<JobResult> => {
    await d.drop(reason).catch(() => {});
    return { status: "done" };
  };

  const e = await d.getEmail(emailId);
  const addr = await d.address(ws);
  if (!addr || !addr.enabled) return drop("off");
  const from = addressOf(e.from);
  if (!from) return drop("unknown_sender");
  // The From line can be faked. Only an email the receiving server proved came from that address is answered.
  if (!authPassed(e.authentication)) return drop("unverified");
  if (from.endsWith(`@${d.domain}`) || isAutomatic(from, e.headers)) return drop("loop");
  const v = senderVerdict(await d.sender(ws, from));
  if (!v.ok) return drop(v.reason);
  if ((await d.inboundSince(ws, new Date(d.now() - HOUR).toISOString())) >= EMAILS_PER_HOUR) return drop("too_many");

  const words = trimEmail(emailText(e), { forward: isForward(e.subject) });
  const subject = cleanSubject(e.subject);
  const content = words || subject;
  if (!content && !e.attachments.length) return drop("empty");

  // Which chat: the token in the address it was sent to, else the In-Reply-To and References headers.
  const to = findTeamAddress([e.to, e.cc, e.received_for], d.domain);
  const byToken = to?.token ? await d.threadByToken(ws, to.token) : null;
  const ids = replyIds(e.headers);
  const messageId = /^<[^<>\s]{1,298}>$/.test(e.message_id ?? "") ? e.message_id! : `<${emailId}@inbound.${d.domain}>`;
  const byId = await d.threadsByMessageIds(ws, [messageId, ...ids]);
  // The same email again (sent to two of our addresses, or the job ran twice): it was already answered.
  if (byId[messageId]) return { status: "done" };
  let threadId = pickThread({ tokenThread: byToken?.thread_id ?? null, ids, byId });
  let token = byToken?.token ?? (threadId ? await d.tokenOf(ws, threadId) : null);
  const userId = v.sender.kind === "member" ? v.sender.userId : null;
  if (!threadId || !token) {
    // A new email, or (rarely) a chat with no email row: a new chat titled from the subject.
    threadId = d.newId();
    token = newThreadToken();
    await d.startThread(ws, { id: threadId, title: emailThreadTitle(e.subject), subject, token, createdBy: userId });
  }

  if (!(await d.recordMessage(ws, threadId, messageId, "in"))) return { status: "done" };
  // Images and PDFs become chat files the team reads; anything else is only named.
  let saved: { files: StoredFile[]; skipped: string[] } = { files: [], skipped: e.attachments.map((a) => a.filename) };
  if (e.attachments.length) {
    try {
      saved = await d.saveAttachments(ws, emailId);
    } catch (err) {
      d.log(`Team email ${emailId}: attachments weren't saved: ${String((err as Error)?.message ?? err).slice(0, 200)}`);
    }
  }
  const meta: StoredEmail = { from, to: teamAddress(addr.slug, d.domain), subject, attachments: saved.skipped.slice(0, 20) };
  await d.saveMessage(ws, threadId, content, { user: from, email: meta, ...(saved.files.length ? { files: saved.files } : {}) });

  // The turn: smart routing picks who answers, a tag in the subject or first line picks them by name.
  let last: { agent: AgentKey; text: string } | null = null;
  const approvals: { id: number; title: string }[] = [];
  await d.runTurn(ws, threadId, routingText(e.subject, content || wordsFor("", saved.files)), (ev) => {
    if (ev.type === "message" && ev.text.trim()) last = { agent: ev.agent, text: ev.text };
    if (ev.type === "approval" && !approvals.some((a) => a.id === ev.id)) approvals.push({ id: ev.id, title: ev.title });
  });
  const answer = last as { agent: AgentKey; text: string } | null;
  if (!answer) {
    d.log(`Team email ${emailId} in workspace ${ws}: the turn gave no answer to send.`);
    return { status: "done" };
  }

  const threadUrl = `${d.appUrl}/chat/${threadId}`;
  const links: ReplyApproval[] = [];
  for (const a of approvals) {
    let approveUrl: string | null = null;
    if (v.sender.kind === "member" && v.sender.canApprove) {
      try {
        approveUrl = await d.approveLink(ws, a.id, v.sender.userId);
      } catch (err) {
        d.log(`Team email ${emailId}: no Approve link for approval ${a.id}: ${String((err as Error)?.message ?? err).slice(0, 200)}`);
      }
    }
    links.push({ id: a.id, title: a.title, approveUrl, openUrl: `${d.appUrl}/approvals/${a.id}` });
  }
  const earlier = (await d.references(ws, threadId)).filter((id) => id !== messageId);
  const outId = `<${d.newId()}@${d.domain}>`;
  const mail = teamReplyEmail({ agent: answer.agent, text: answer.text, subject: e.subject, approvals: links, threadUrl, address: teamAddress(addr.slug, d.domain) });
  const send = () =>
    d.send(from, mail, {
      from: replyFrom(answer.agent, addr.slug, d.domain),
      replyTo: teamAddress(addr.slug, d.domain, token),
      headers: { ...replyHeaders(messageId, earlier), "Message-ID": outId },
      idempotencyKey: `team-email-${emailId}`,
    });
  try {
    await send().catch(async () => send());
  } catch (err) {
    // The turn ran and is in the chat. Running the job again would not send it, so it fails here for staff to see.
    return { status: "failed", error: `The answer to team email ${emailId} wasn't sent: ${String((err as Error)?.message ?? err)}` };
  }
  await d.recordMessage(ws, threadId, outId, "out").catch(() => false);
  return { status: "done" };
}
