// The Approve link in a team email (src/lib/teamEmailReply.ts). The link holds a token sealed with the server's key
// (src/lib/sealing.ts) that names one approval, its workspace, the member it was sent to and a nonce, and says when
// it stops working (72 hours). The nonce is a row in approval_links (supabase/023_team_email.sql), used once.
//
// Opening the link (GET /api/email/approve) only shows the change and a button, so a mail scanner that opens every
// link approves nothing. Pressing the button (POST) uses the link and approves through the same path as the app
// (decide() in src/lib/approvals.ts), as that member, who must still be an editor or up.
// Pure: the keyring, the clock and the random bytes come in as arguments.
import { openWith, sealWith, type Keyring } from "./sealing.ts";

export const APPROVE_LINK_HOURS = 72;
const HOUR = 3_600_000;

/** What a token says. a: approval id, w: workspace, u: member, n: nonce, e: when it stops working (ms). */
export type LinkClaims = { a: number; w: string; u: string; n: string; e: number };

const aad = (approvalId: number) => `approve-link:${approvalId}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const NONCE = /^[A-Za-z0-9_-]{16,64}$/;

/** A new nonce: 24 random bytes as base64url. */
export function newNonce(random: (n: number) => Uint8Array = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n))): string {
  return Buffer.from(random(24)).toString("base64url");
}

/** Seals a token for one approval and one member. The approval id is bound in, so the token works for no other. */
export function makeApproveToken(ring: Keyring, o: { approvalId: number; workspaceId: string; userId: string; nonce: string; now: number }): { token: string; expiresAt: string } {
  const e = o.now + APPROVE_LINK_HOURS * HOUR;
  const claims: LinkClaims = { a: o.approvalId, w: o.workspaceId, u: o.userId, n: o.nonce, e };
  return { token: sealWith(ring, JSON.stringify(claims), aad(o.approvalId)), expiresAt: new Date(e).toISOString() };
}

/** Opens a token for the approval in the link. "bad" for a changed, foreign or broken token, "expired" after 72 hours. */
export function readApproveToken(ring: Keyring, approvalId: number | null, token: unknown, now: number): { ok: true; claims: LinkClaims } | { ok: false; reason: "bad" | "expired" } {
  if (!approvalId || typeof token !== "string" || token.length > 2000) return { ok: false, reason: "bad" };
  let c: LinkClaims;
  try {
    c = JSON.parse(openWith(ring, token, aad(approvalId))) as LinkClaims;
  } catch {
    return { ok: false, reason: "bad" };
  }
  if (!c || c.a !== approvalId || !UUID.test(String(c.w)) || !UUID.test(String(c.u)) || !NONCE.test(String(c.n)) || !Number.isFinite(c.e)) return { ok: false, reason: "bad" };
  if (now >= c.e) return { ok: false, reason: "expired" };
  return { ok: true, claims: c };
}

export type LinkRow = { nonce: string; approval_id: number; workspace_id: string; user_id: string; expires_at: string; used_at: string | null };
export type LinkState = "ok" | "missing" | "used" | "expired";

/**
 * Whether a link can still be used, from its row. The same rules as use_approval_link() in SQL: the row must match
 * the token's approval, workspace and member, be unused and not expired.
 */
export function linkState(row: LinkRow | null | undefined, c: LinkClaims, now: number): LinkState {
  if (!row || row.nonce !== c.n || Number(row.approval_id) !== c.a || row.workspace_id !== c.w || row.user_id !== c.u) return "missing";
  if (row.used_at) return "used";
  if (now >= Date.parse(row.expires_at)) return "expired";
  return "ok";
}

/** The link in the email. */
export function approveUrl(appUrl: string, approvalId: number, token: string): string {
  return `${appUrl.replace(/\/+$/, "")}/api/email/approve?a=${approvalId}&t=${encodeURIComponent(token)}`;
}

// ─────────────── the page ───────────────

export const LINK_MESSAGES = {
  confirmTitle: "Approve this change?",
  confirmButton: "Approve",
  confirmNote: "Nothing happens until you press Approve.",
  open: "Open in Morning Telos",
  bad: "This link doesn't work. Open the approval in Morning Telos instead.",
  expired: "This link has expired. Links work for 72 hours. Open the approval in Morning Telos instead.",
  used: "This link was already used. Open Morning Telos to see how it went.",
  handled: "This one was already handled. Open Morning Telos to see how it went.",
  off: "Approving by email is not turned on.",
  done: "Approved and done.",
  failed: "Approved, but it didn't work. Open Morning Telos to see why.",
  denied: "You can't approve this one. Ask the owner, or open it in Morning Telos.",
  broken: "Something went wrong. Try again from Morning Telos.",
} as const;

const esc = (s: string) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export type PageInput =
  | { kind: "confirm"; title: string; why: string; approvalId: number; token: string; openUrl: string }
  | { kind: "note"; title: string; text: string; openUrl: string };

/** The small confirm page and the pages after it. A form with a button for confirm; a line and a link for the rest. */
export function approvePage(p: PageInput): string {
  const body =
    p.kind === "confirm"
      ? `<h1>${esc(LINK_MESSAGES.confirmTitle)}</h1>
<p class="item">${esc(p.title)}</p>${p.why ? `\n<p class="why">${esc(p.why)}</p>` : ""}
<form method="post" action="/api/email/approve">
<input type="hidden" name="a" value="${p.approvalId}">
<input type="hidden" name="t" value="${esc(p.token)}">
<button type="submit">${esc(LINK_MESSAGES.confirmButton)}</button>
</form>
<p class="note">${esc(LINK_MESSAGES.confirmNote)}</p>`
      : `<h1>${esc(p.title)}</h1>
<p>${esc(p.text)}</p>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(p.kind === "confirm" ? LINK_MESSAGES.confirmTitle : p.title)} | Morning Telos</title>
<style>body{margin:0;background:#faf9f5;color:#141413;font:16px/1.55 Helvetica,Arial,sans-serif}main{max-width:460px;margin:48px auto;padding:0 20px}.brand{font-weight:600;font-size:15px;margin:0 0 28px}h1{font:400 26px/1.25 Georgia,'Times New Roman',serif;margin:0 0 14px}p{color:#3a3a37;margin:0 0 14px}.item{background:#fff;border:1px solid #e8e6dc;border-radius:10px;padding:12px 14px;color:#141413}.why,.note{color:#65645f;font-size:14px}button{background:#141413;color:#fff;border:0;border-radius:10px;padding:12px 22px;font:600 15px Helvetica,Arial,sans-serif;cursor:pointer}a{color:#141413}</style></head>
<body><main><p class="brand">Morning Telos</p>
${body}
<p><a href="${esc(p.openUrl)}">${esc(LINK_MESSAGES.open)}</a></p>
</main></body></html>`;
}

// ─────────────── the route ───────────────

export type ApproveLinkDeps = {
  /** False while TEAM_EMAIL_DOMAIN is empty: the page answers 404. */
  on: boolean;
  ring: () => Keyring;
  now: number;
  appUrl: string;
  link: (nonce: string) => Promise<LinkRow | null>;
  approval: (workspaceId: string, id: number) => Promise<{ id: number; title: string; why: string; status: string } | null>;
  /** True when the member may still approve in that workspace (editor or up). */
  canApprove: (workspaceId: string, userId: string) => Promise<boolean>;
  /** use_approval_link(): marks the link used, once. */
  use: (nonce: string, approvalId: number, userId: string) => Promise<LinkState>;
  /** decide() with the approvals path the app uses (src/lib/teamTools.ts decideDeps). */
  decide: (workspaceId: string, approvalId: number, userId: string) => Promise<{ status: number; body: { status?: string; error?: string } }>;
};

export type PageResult = { status: number; html: string };

const NOTE_FOR: Record<Exclude<LinkState, "ok"> | "bad", string> = { missing: LINK_MESSAGES.bad, bad: LINK_MESSAGES.bad, used: LINK_MESSAGES.used, expired: LINK_MESSAGES.expired };

/**
 * GET shows the change and an Approve button and changes nothing. POST uses the link and approves, as the member it
 * was sent to. `a` is the approval id and `t` the token, from the link's query or the form.
 */
export async function handleApproveLink(method: "GET" | "POST", input: { a: unknown; t: unknown }, d: ApproveLinkDeps): Promise<PageResult> {
  const id = typeof input.a === "string" && /^\d{1,15}$/.test(input.a) ? Number(input.a) : null;
  const open = id ? `${d.appUrl}/approvals/${id}` : `${d.appUrl}/approvals`;
  const note = (text: string, status = 200, title = "Approvals"): PageResult => ({ status, html: approvePage({ kind: "note", title, text, openUrl: open }) });
  if (!d.on) return note(LINK_MESSAGES.off, 404);
  const read = readApproveToken(d.ring(), id, input.t, d.now);
  if (!read.ok) return note(NOTE_FOR[read.reason]);
  const c = read.claims;
  const state = linkState(await d.link(c.n), c, d.now);
  if (state !== "ok") return note(NOTE_FOR[state]);
  const ap = await d.approval(c.w, c.a);
  if (!ap) return note(LINK_MESSAGES.bad);
  if (ap.status !== "pending") return note(LINK_MESSAGES.handled);
  if (!(await d.canApprove(c.w, c.u))) return note(LINK_MESSAGES.denied);
  if (method === "GET") return { status: 200, html: approvePage({ kind: "confirm", title: ap.title, why: ap.why, approvalId: c.a, token: String(input.t), openUrl: open }) };

  const used = await d.use(c.n, c.a, c.u);
  if (used !== "ok") return note(NOTE_FOR[used]);
  const out = await d.decide(c.w, c.a, c.u);
  if (out.status === 200 && out.body.status === "done") return note(LINK_MESSAGES.done, 200, ap.title);
  if (out.status === 200 && out.body.status === "failed") return note(LINK_MESSAGES.failed, 200, ap.title);
  if (out.status === 409) return note(LINK_MESSAGES.handled);
  if (out.status === 404) return note(LINK_MESSAGES.bad);
  return note(LINK_MESSAGES.broken, 500);
}
