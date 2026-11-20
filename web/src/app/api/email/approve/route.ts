import * as Sentry from "@sentry/nextjs";
import { decide } from "@/lib/approvals";
import { appUrl } from "@/lib/emailKit";
import { approvePage, handleApproveLink, LINK_MESSAGES, type ApproveLinkDeps, type LinkRow, type LinkState } from "@/lib/approveLink";
import { envKeyring } from "@/lib/sealing";
import { adminClient } from "@/lib/serverAuth";
import { teamEmailDomain } from "@/lib/teamEmail";
import { decideDeps } from "@/lib/teamTools";

// The Approve link in a team email (src/lib/approveLink.ts). GET shows the change and a button and changes nothing,
// so mail scanners that open links approve nothing. POST (the button) uses the link once and approves through the
// same path as the app, as the member the email went to. Off (404) while TEAM_EMAIL_DOMAIN is empty.
export const dynamic = "force-dynamic";
// Approving runs the change, which may take up to 90 seconds (src/lib/mcpClient.ts).
export const maxDuration = 120;

function log(message: string) {
  console.error(message);
  Sentry.captureMessage(message, { level: "warning", tags: { area: "approve_link" } });
}

const page = (r: { status: number; html: string }) =>
  new Response(r.html, {
    status: r.status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY" },
  });

function deps(): ApproveLinkDeps | null {
  const db = adminClient();
  if (!db) return null;
  return {
    on: Boolean(teamEmailDomain(process.env)),
    ring: () => envKeyring(),
    now: Date.now(),
    appUrl: appUrl(),
    link: async (nonce) => {
      const { data, error } = await db.from("approval_links").select("nonce, approval_id, workspace_id, user_id, expires_at, used_at").eq("nonce", nonce).maybeSingle();
      if (error) throw new Error(error.message);
      return data as LinkRow | null;
    },
    approval: async (ws, id) => {
      const { data, error } = await db.from("approvals").select("id, title, why, status").eq("id", id).eq("workspace_id", ws).maybeSingle();
      if (error) throw new Error(error.message);
      return data as { id: number; title: string; why: string; status: string } | null;
    },
    canApprove: async (ws, userId) => {
      const { data, error } = await db.from("workspace_members").select("role").eq("workspace_id", ws).eq("user_id", userId).maybeSingle();
      if (error) throw new Error(error.message);
      return ["owner", "admin", "editor"].includes(String((data as { role?: string } | null)?.role));
    },
    use: async (nonce, approvalId, userId) => {
      const { data, error } = await db.rpc("use_approval_link", { p_nonce: nonce, p_approval: approvalId, p_user: userId });
      if (error) throw new Error(error.message);
      return data as LinkState;
    },
    decide: (ws, approvalId, userId) => decide(approvalId, userId, { action: "approve", input: null }, decideDeps(db, ws, log)),
  };
}

async function run(method: "GET" | "POST", input: { a: unknown; t: unknown }) {
  const d = deps();
  const broken = { status: 500, html: approvePage({ kind: "note", title: "Approvals", text: LINK_MESSAGES.broken, openUrl: `${appUrl()}/approvals` }) };
  if (!d) return page(broken);
  try {
    return page(await handleApproveLink(method, input, d));
  } catch (e) {
    log(`Approve link (${method}) failed: ${e instanceof Error ? e.message : String(e)}`);
    return page(broken);
  }
}

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  return run("GET", { a: q.get("a"), t: q.get("t") });
}

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  return run("POST", { a: form?.get("a"), t: form?.get("t") });
}
