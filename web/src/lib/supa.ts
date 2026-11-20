import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { quickSignOut } from "./authLinks.ts";

export type SupaConfig = { url: string; key: string };

let client: SupabaseClient | null = null;
let config: SupaConfig | null = null;

/** One Supabase client for the browser. Sessions are kept in this browser and refresh on their own. */
export function getSupabase({ url, key }: SupaConfig): SupabaseClient {
  config ??= { url, key };
  client ??= createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" },
  });
  return client;
}

/** The browser's client, once the app has made it. Pages that aren't handed one use this. */
export function currentSupabase(): SupabaseClient {
  if (!client) throw new Error("Supabase is not set up yet.");
  return client;
}

/** Log out on this device at once; Supabase Auth ends the session in the background (src/lib/authLinks.ts). */
export function signOutNow(sb: SupabaseClient): Promise<void> {
  return quickSignOut(sb.auth, { url: config?.url ?? "", key: config?.key ?? "" });
}
