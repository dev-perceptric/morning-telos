// Which server keys the app needs before it can run, and which are missing.
// Read on each request so changed settings apply without a rebuild.

export const REQUIRED_KEYS = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY"] as const;

export type ConfigCheck = { missing: string[]; problems: string[] };

export function checkConfig(env: Record<string, string | undefined>): ConfigCheck {
  const get = (k: string) => (env[k] ?? "").trim();
  const missing = REQUIRED_KEYS.filter((k) => !get(k));
  const problems: string[] = [];
  const url = get("SUPABASE_URL");
  if (url && !/^https:\/\/[^\s/]+/.test(url)) problems.push("SUPABASE_URL should start with https://");
  const key = get("SUPABASE_PUBLISHABLE_KEY");
  if (key && !key.startsWith("sb_publishable_") && !key.startsWith("eyJ"))
    problems.push("SUPABASE_PUBLISHABLE_KEY should start with sb_publishable_. Copy it from Supabase, Project Settings, API Keys.");
  return { missing, problems };
}
