import "server-only";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { DEFAULT_FROM } from "./workspaceMail.ts";

// Who is calling and what they may do, for API routes. Copied from Arrowsterr's serverAuth.ts.

export type Min = "owner" | "admin" | "editor" | "viewer";

export const supabaseUrl = () => process.env.SUPABASE_URL?.trim().replace(/\/+$/, "") ?? "";

/**
 * Check the caller is signed in and has at least `min` role in the workspace.
 * Returns a Supabase client that acts as the caller and the user, or a Response to send back.
 */
export async function requireRole(request: Request, workspaceId: unknown, min: Min): Promise<{ sb: SupabaseClient; user: User; userId: string; email: string | null } | { denied: Response }> {
  const url = supabaseUrl();
  const key = process.env.SUPABASE_PUBLISHABLE_KEY?.trim();
  const deny = (error: string, status: number) => ({ denied: Response.json({ error }, { status }) });
  if (!url || !key) return deny("Supabase is not set up on the server.", 500);
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return deny("Please sign in again.", 401);
  if (typeof workspaceId !== "string" || !workspaceId) return deny("Missing workspace.", 400);

  const sb = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: user } = await sb.auth.getUser(token);
  if (!user?.user) return deny("Please sign in again.", 401);
  const { data: ok, error } = await sb.rpc("has_role", { ws: workspaceId, min });
  if (error) return deny(error.message, 500);
  if (!ok) return deny(min === "owner" ? "Only the workspace owner can do that." : `You need ${min} access in this workspace to do that.`, 403);
  return { sb, user: user.user, userId: user.user.id, email: user.user.email ?? null };
}

/** The signed-in person, checked with Supabase, or null. For routes that aren't about one workspace (the staff console). */
export async function signedInUser(request: Request): Promise<User | null> {
  const url = supabaseUrl();
  const key = process.env.SUPABASE_PUBLISHABLE_KEY?.trim();
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!url || !key || !token) return null;
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data } = await sb.auth.getUser(token);
  return data?.user ?? null;
}

/** True when the signed-in person can make changes (and spend) in the workspace. */
export async function isEditor(sb: SupabaseClient, workspaceId: string): Promise<boolean> {
  const { data } = await sb.rpc("has_role", { ws: workspaceId, min: "editor" });
  return Boolean(data);
}

/** A Supabase client with full access, for billing, jobs and the login routes. Needs SUPABASE_SECRET_KEY. Never send it to the browser. */
export function adminClient(): SupabaseClient | null {
  const url = supabaseUrl();
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/**
 * requireRole as a Gate for the pure route logic (src/lib/workspaceRoutes.ts). `client()` is the caller's
 * Supabase client once the gate has passed.
 */
export function roleGate(request: Request, workspaceId: unknown) {
  let sb: SupabaseClient | null = null;
  const gate = async (min: Min) => {
    const r = await requireRole(request, workspaceId, min);
    if ("denied" in r) {
      const body = (await r.denied.clone().json().catch(() => ({}))) as { error?: string };
      return { ok: false as const, status: r.denied.status, error: body.error ?? "Not allowed." };
    }
    sb = r.sb;
    return { ok: true as const, userId: r.userId, email: r.email };
  };
  const client = () => {
    if (!sb) throw new Error("Check the role first.");
    return sb;
  };
  return { gate, client };
}

/** The app's public address for links in emails: APP_URL, or else the address this request came to. */
export function appOrigin(request: Request): string {
  const set = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (set) return set;
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

/** Resend settings from the server's environment. An empty key means email is off. */
export function resendSettings() {
  return { key: process.env.RESEND_API_KEY?.trim() ?? "", from: process.env.EMAIL_FROM?.trim() || DEFAULT_FROM, fetch };
}
