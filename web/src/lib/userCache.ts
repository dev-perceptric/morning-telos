// Who a sign-in token belongs to, remembered for a minute. Checking a token with Supabase Auth (getUser) is a network
// call, and a page fires several API calls at once, so each one waited on its own check. A token the database
// already trusts (PostgREST checks only its signature and expiry) is remembered here for at most CACHE_MS and never
// past its own expiry; a refused token is never remembered. Keys are a hash of the token, never the token itself.
// Pure apart from node:crypto, so tests use a fake clock and a fake check.
import { createHash } from "node:crypto";

export const CACHE_MS = 60_000;
export const CACHE_MAX = 2000;

/** The token's expiry (its exp claim) in milliseconds, or null when it can't be read. */
export function tokenExpiry(token: string): number | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const exp = (JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as { exp?: unknown }).exp;
    return typeof exp === "number" && Number.isFinite(exp) ? exp * 1000 : null;
  } catch {
    return null;
  }
}

const keyOf = (token: string) => createHash("sha256").update(token).digest("base64url");

export function userCache<U>(o: { ttlMs?: number; max?: number; now?: () => number } = {}) {
  const ttl = o.ttlMs ?? CACHE_MS;
  const max = o.max ?? CACHE_MAX;
  const now = o.now ?? Date.now;
  const seen = new Map<string, { user: U; until: number }>();
  return {
    /** The token's user: remembered when still fresh, else checked with `check` (and remembered when it passes). */
    async get(token: string, check: () => Promise<U | null>): Promise<U | null> {
      const key = keyOf(token);
      const t = now();
      const hit = seen.get(key);
      if (hit && hit.until > t) return hit.user;
      if (hit) seen.delete(key);
      const user = await check();
      if (!user) return null;
      const exp = tokenExpiry(token);
      const until = Math.min(t + ttl, exp ?? t + ttl);
      if (until > t) {
        if (seen.size >= max) {
          for (const [k, v] of seen) if (v.until <= t) seen.delete(k);
          // Still full: drop the oldest.
          while (seen.size >= max) seen.delete(seen.keys().next().value as string);
        }
        seen.set(key, { user, until });
      }
      return user;
    },
    size: () => seen.size,
  };
}
