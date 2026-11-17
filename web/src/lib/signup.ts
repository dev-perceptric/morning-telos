// What sign-up sends to Supabase as user metadata. The database reads business, website and timezone
// to make the person's workspace (handle_new_user in supabase/schema.sql).

export type SignupMeta = { name: string; business: string; website: string; timezone: string };

/** "https://www.Shop.com/" → "www.shop.com". Empty when it doesn't look like a web address. */
export function cleanWebsite(v: string): string {
  const s = v.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "").toLowerCase().slice(0, 200);
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/.test(s) ? s : "";
}

/** A real IANA time zone, or the default. */
export function cleanTimezone(z: string | undefined, fallback = "America/Chicago"): string {
  if (!z) return fallback;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: z });
    return z;
  } catch {
    return fallback;
  }
}

export function signupMeta(input: { name: string; business: string; website: string; timezone?: string }): SignupMeta {
  return {
    name: input.name.trim().slice(0, 80),
    business: input.business.trim().slice(0, 120),
    website: cleanWebsite(input.website),
    timezone: cleanTimezone(input.timezone),
  };
}
