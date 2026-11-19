import * as Sentry from "@sentry/nextjs";
import { rateLimiter } from "@/lib/chat";
import { otherExtension, preflight, refuseOtherExtension, withCors } from "@/lib/cors";
import { newSession, refreshSettings } from "@/lib/extensionSession";
import { adminClient, appOrigin, roleGate, signedInUser } from "@/lib/serverAuth";
import { NEEDS } from "@/lib/workspace";

// The Chrome extension's API (extension/), shaped like Omniscient's /api/extension/[action]. Nothing here sends,
// publishes or changes anything outside the app.
//   Signed in to the app:
//     connect    makes this browser its own sign-in session. Settings, Chrome extension hands it to the extension
//                when the person clicks Connect this browser. Only the app itself may call it, never an extension.
//   With the extension's bearer token (a Supabase access token, checked like every other route):
//     me         who is signed in and their workspaces with their role.
//     approvals  the workspace's approvals waiting for a person, newest first, for the badge and the Approvals tab.
//     thread     one chat's messages, to show it again in the side panel.
// Reads go through the caller's own Supabase client, so row level security decides what they see, as in the app.
// Only the extension's origin gets CORS (src/lib/cors.ts).
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
const SIGN_IN = "Sign in to Morning Telos again.";

// 10 connects an hour per person is plenty for a few browsers.
const connects = rateLimiter(10, 60 * 60 * 1000);

function log(message: string) {
  console.error(message);
  Sentry.captureMessage(message, { level: "warning", tags: { area: "extension" } });
}

export const OPTIONS = (request: Request) => preflight(request);

export async function GET(request: Request, ctx: { params: Promise<{ action: string }> }) {
  const refused = refuseOtherExtension(request);
  if (refused) return refused;
  return withCors(request, await read(request, (await ctx.params).action));
}

export async function POST(request: Request, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;
  if (action !== "connect") return json({ error: "Not found." }, 404);
  // The app calls this from its own page. No extension, ours included, may make itself a session.
  if (otherExtension(request.headers.get("origin"), [])) return json({ error: "Not allowed." }, 403);
  const user = await signedInUser(request);
  if (!user) return json({ error: SIGN_IN }, 401);
  if (!user.email) return json({ error: "Add an email to your account first." }, 400);
  if (connects(user.id)) return json({ error: "That's a lot of tries. Try again in an hour." }, 429);
  const db = adminClient();
  if (!db) return json({ error: "Add SUPABASE_SECRET_KEY to the server's settings." }, 500);
  try {
    const session = await newSession(db, user.email);
    return json({ session, ...refreshSettings(), app: appOrigin(request) });
  } catch (e) {
    log(`Extension connect failed for ${user.id}: ${e instanceof Error ? e.message : String(e)}`);
    return json({ error: "We couldn't connect this browser. Try again." }, 500);
  }
}

async function read(request: Request, action: string): Promise<Response> {
  const q = new URL(request.url).searchParams;

  if (action === "me") {
    const user = await signedInUser(request);
    if (!user) return json({ error: SIGN_IN }, 401);
    const db = adminClient();
    if (!db) return json({ error: "Add SUPABASE_SECRET_KEY to the server's settings." }, 500);
    // Only this person's own memberships. The workspace names come from those rows' ids.
    const { data: rows, error } = await db.from("workspace_members").select("workspace_id, role, created_at").eq("user_id", user.id).order("created_at").limit(50);
    if (error) return json({ error: "Something went wrong. Try again." }, 500);
    const members = (rows ?? []) as { workspace_id: string; role: string }[];
    const named = await Promise.all(members.map((m) => db.from("workspaces").select("id, name").eq("id", m.workspace_id).maybeSingle()));
    const workspaces = members.flatMap((m, i) => {
      const w = named[i].data as { id: string; name: string } | null;
      return w ? [{ id: w.id, name: w.name, role: m.role }] : [];
    });
    return json({ email: user.email ?? "", workspaces, app: appOrigin(request) });
  }

  if (action === "approvals") {
    const ws = q.get("workspaceId");
    const { gate, client } = roleGate(request, ws);
    const who = await gate(NEEDS.readChats);
    if (!who.ok) return json({ error: who.error }, who.status);
    const { data, error } = await client()
      .from("approvals")
      .select("id, thread_id, agent, title, why, status, created_at")
      .eq("workspace_id", ws)
      .eq("status", "pending")
      .order("id", { ascending: false })
      .limit(50);
    if (error) return json({ error: "We couldn't load approvals. Try again." }, 500);
    const approvals = ((data ?? []) as Record<string, unknown>[]).map((a) => ({ id: a.id, thread_id: a.thread_id, agent: a.agent, title: a.title, why: a.why, status: a.status, created_at: a.created_at }));
    return json({ count: approvals.length, approvals });
  }

  if (action === "thread") {
    const ws = q.get("workspaceId");
    const id = q.get("id") ?? "";
    const { gate, client } = roleGate(request, ws);
    const who = await gate(NEEDS.readChats);
    if (!who.ok) return json({ error: who.error }, who.status);
    if (!UUID.test(id)) return json({ error: "That chat was not found." }, 404);
    const sb = client();
    const { data: t } = await sb.from("threads").select("id, title").eq("id", id).eq("workspace_id", ws).maybeSingle();
    if (!t) return json({ error: "That chat was not found." }, 404);
    const { data, error } = await sb.from("messages").select("id, role, agent, content, meta").eq("thread_id", id).eq("workspace_id", ws).order("id", { ascending: false }).limit(40);
    if (error) return json({ error: "We couldn't load that chat. Try again." }, 500);
    const messages = ((data ?? []) as { id: number; role: string; agent: string | null; content: string; meta: Record<string, unknown> | null }[]).reverse().map((m) => {
      const page = m.meta?.page as { title?: unknown; url?: unknown } | undefined;
      return {
        id: m.id,
        role: m.role,
        agent: m.agent,
        content: m.content,
        error: Boolean(m.meta?.error),
        page: page && typeof page.url === "string" ? { url: page.url, title: typeof page.title === "string" ? page.title : "" } : null,
        approvals: Array.isArray(m.meta?.approvals) ? m.meta.approvals : [],
      };
    });
    return json({ title: (t as { title: string }).title, messages });
  }

  return json({ error: "Not found." }, 404);
}
