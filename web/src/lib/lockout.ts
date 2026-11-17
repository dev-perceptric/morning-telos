// Wrong-password limits, counted over 15 minutes (and an hour for one email from anywhere).
// pair: one email from one address. ip: one address in total. emailHour: one email from anywhere.
export const LIMITS = { pair: 5, ip: 20, emailHour: 30 };

export type WrongTries = { pair: number; ip: number; emailHour: number };

/** True when sign-in should pause for this email and address. */
export function isLocked(n: WrongTries): boolean {
  return n.pair >= LIMITS.pair || n.ip >= LIMITS.ip || n.emailHour >= LIMITS.emailHour;
}

/** The caller's address from proxy headers. The proxy adds the real one last, so a sent header can't fake it. */
export function ipFrom(realIp: string | null, forwardedFor: string | null): string {
  const real = realIp?.trim();
  if (real) return real.slice(0, 64);
  const list = (forwardedFor ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return (list[list.length - 1] ?? "").slice(0, 64);
}

/** Lowercased, trimmed email, or "" when it doesn't look like one. */
export function cleanEmail(v: unknown): string {
  const e = String(v ?? "").trim().toLowerCase().slice(0, 320);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : "";
}
