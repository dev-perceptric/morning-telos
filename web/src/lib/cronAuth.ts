// Checks the worker's CRON_SECRET. Copied from Arrowsterr's and Omniscient's src/lib/cronAuth.ts, with the secret
// passed in so tests can call it. Both sides are hashed first, so the compare takes the same time whatever the length.
import { createHash, timingSafeEqual } from "node:crypto";

const hash = (s: string) => createHash("sha256").update(s).digest();

/** True when the Authorization header is "Bearer <secret>". Always false while the secret isn't set. */
export function cronAllowed(authorization: string | null, secret: string | undefined): boolean {
  const want = secret?.trim() ?? "";
  const given = authorization?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (!want || !given) return false;
  return timingSafeEqual(hash(want), hash(given));
}
