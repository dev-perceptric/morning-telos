import { appUrl } from "@/lib/emailKit";
import { envKeyring, type Keyring } from "@/lib/sealing";
import { adminClient } from "@/lib/serverAuth";
import { handleUnsubscribe, type Unsubscriber } from "@/lib/unsubscribe";

// The one-click unsubscribe link in the weekly digest (src/lib/unsubscribe.ts). GET shows one button; POST (that
// button, or a mail app's own Unsubscribe) turns the digest and tips off. No sign-in: the sealed token says who.

export const dynamic = "force-dynamic";

function ring(): Keyring | null {
  try {
    return envKeyring();
  } catch {
    return null;
  }
}

async function save(u: Unsubscriber) {
  const db = adminClient();
  if (!db) throw new Error("Add SUPABASE_SECRET_KEY to the server's settings.");
  const { error } = await db.from("email_prefs").upsert({ workspace_id: u.workspaceId, user_id: u.userId, digest: false, updated_at: new Date().toISOString() }, { onConflict: "workspace_id,user_id" });
  if (error) throw new Error(error.message);
}

async function respond(request: Request) {
  const token = new URL(request.url).searchParams.get("t");
  const out = await handleUnsubscribe({ method: request.method, token }, { ring: ring(), save, appUrl: appUrl() });
  return new Response(out.html, { status: out.status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}

export const GET = respond;
export const POST = respond;
