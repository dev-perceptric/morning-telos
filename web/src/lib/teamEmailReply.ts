// The answer to a team email: sent from the workspace's address as "<Teammate> at Morning Telos", threaded with
// In-Reply-To and References so it lands in the same conversation, with a reply-to that carries the chat's token, the
// answer drawn by the email kit (src/lib/emailKit.ts), the approvals it prepared, and a link to the chat. Pure.
import { renderEmail, type Block, type Email } from "./emailKit.ts";
import { AGENTS, type AgentKey } from "./team.ts";
import { replySubject, teamAddress, TEAM_EMAIL_MESSAGES } from "./teamEmail.ts";

/** An approval the turn prepared. approveUrl is null when the sender can't approve (an extra sender). */
export type ReplyApproval = { id: number; title: string; approveUrl: string | null; openUrl: string };

/** "Hermes at Morning Telos". */
export const replyFromName = (agent: AgentKey) => `${AGENTS[agent].god} at Morning Telos`;

/** The From line: the teammate's name and the workspace's own address. */
export const replyFrom = (agent: AgentKey, slug: string, domain: string) => `${replyFromName(agent)} <${teamAddress(slug, domain)}>`;

/** Most Message-IDs kept in References. Mail clients only need the first and the last few. */
export const MAX_REFERENCES = 20;

/**
 * The threading headers. In-Reply-To is the email being answered; References is the conversation so far, oldest
 * first, ending with that email. Long conversations keep the first id and the newest ones.
 */
export function replyHeaders(inReplyTo: string, earlier: string[]): Record<string, string> {
  const ids = [...new Set([...earlier, inReplyTo].filter((id) => /^<[^<>\s]{1,298}>$/.test(id)))];
  const refs = ids.length > MAX_REFERENCES ? [ids[0], ...ids.slice(-(MAX_REFERENCES - 1))] : ids;
  return { "In-Reply-To": inReplyTo, References: refs.join(" ") };
}

export type ReplyInput = {
  agent: AgentKey;
  /** The teammate's answer, in Markdown. */
  text: string;
  subject: string;
  approvals: ReplyApproval[];
  threadUrl: string;
  /** The workspace's address, for the footer. */
  address: string;
};

/** The answer as an email. */
export function teamReplyEmail(r: ReplyInput): Email {
  const god = AGENTS[r.agent].god;
  const blocks: Block[] = [{ t: "md", text: r.text.trim() || "Done." }];
  if (r.approvals.length) {
    blocks.push({ t: "p", text: r.approvals.length === 1 ? "This needs your OK:" : `These ${r.approvals.length} need your OK:` });
    for (const a of r.approvals) {
      blocks.push({ t: "item", text: a.title, links: [...(a.approveUrl ? [{ label: "Approve", url: a.approveUrl }] : []), { label: "Open", url: a.openUrl }] });
    }
    if (r.approvals.some((a) => !a.approveUrl)) blocks.push({ t: "small", text: TEAM_EMAIL_MESSAGES.noApproveLink });
  }
  const subject = replySubject(r.subject);
  return renderEmail({
    subject,
    preview: r.text.replace(/[#*`>|_-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 140) || `${god} answered your email.`,
    title: `${god} answered`,
    blocks,
    link: { label: "Open in Morning Telos", url: r.threadUrl },
    footer: { text: `You emailed ${r.address}. Reply to this email to keep the chat going.` },
  });
}
