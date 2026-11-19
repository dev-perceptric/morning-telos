import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseUrl } from "./serverAuth.ts";

// The Chrome extension's own sign-in session, copied from Omniscient's src/lib/extensionSession.ts. Each connected
// browser gets a session of its own, separate from the person's session in the app, so signing out of one never signs
// out the other and the two never fight over one refresh token. It's made when the person clicks Connect this
// browser in the app (POST /api/extension/connect), from a one-time sign-in link that is never sent anywhere.
// The extension keeps it in its own storage and refreshes it with Supabase the way the app does.

export type ExtensionSession = { access_token: string; refresh_token: string; expires_at: number };

const publishable = () => process.env.SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";

/** A new session for this person. Throws a short message when Supabase says no. */
export async function newSession(admin: SupabaseClient, email: string): Promise<ExtensionSession> {
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const hash = data?.properties?.hashed_token;
  if (error || !hash) throw new Error(error?.message ?? "Couldn't start a session.");
  const res = await fetch(`${supabaseUrl()}/auth/v1/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: publishable() },
    body: JSON.stringify({ type: "magiclink", token_hash: hash }),
  });
  const s = (await res.json().catch(() => ({}))) as Partial<ExtensionSession> & { expires_in?: number };
  if (!res.ok || typeof s.access_token !== "string" || typeof s.refresh_token !== "string") throw new Error("Couldn't start a session.");
  const expires = typeof s.expires_at === "number" ? s.expires_at : Math.floor(Date.now() / 1000) + (s.expires_in ?? 3600);
  return { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: expires };
}

/** What the extension needs to refresh the session itself: the Supabase address and its publishable key (not a secret). */
export const refreshSettings = () => ({ supabaseUrl: supabaseUrl(), publishableKey: publishable() });
