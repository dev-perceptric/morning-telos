import "server-only";
import { ipFrom, isLocked, LIMITS } from "./lockout.ts";

// Helpers for the login security routes (src/app/api/auth).
export { isLocked, LIMITS };

/** The caller's address. The proxy in front of the app adds the real one last, so a sent header can't fake it. */
export function clientIp(request: Request): string {
  return ipFrom(request.headers.get("x-real-ip"), request.headers.get("x-forwarded-for"));
}
