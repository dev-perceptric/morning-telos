// Hora's booking rules: the days and hours she books meetings in, how long they are, and the gap between them. The
// owner or an admin sets them on Hora's Settings tab; they're saved in agent_prefs.settings.booking
// (027_booking_rules.sql) and given to Hora in her instructions (agentLoop.ts systemPrompt). Shared by the browser and
// the server.

export type Booking = { days: number[]; start: string; end: string; length: number; gap: number };

/** Monday to Friday, 9 to 5, 30 minute meetings, 15 minutes between. */
export const DEFAULT_BOOKING: Booking = { days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00", length: 30, gap: 15 };
export const LENGTHS = [15, 30, 45, 60] as const;
export const GAPS = [0, 5, 10, 15, 30] as const;
/** 1 is Monday, 7 is Sunday. */
export const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Saved rules made safe: anything missing or wrong falls back to the default. */
export function cleanBooking(v: unknown): Booking {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const days = Array.isArray(o.days) ? [...new Set(o.days.filter((d): d is number => Number.isInteger(d) && d >= 1 && d <= 7))].sort() : [];
  const start = typeof o.start === "string" && HHMM.test(o.start) ? o.start : DEFAULT_BOOKING.start;
  const end = typeof o.end === "string" && HHMM.test(o.end) ? o.end : DEFAULT_BOOKING.end;
  const length = (LENGTHS as readonly number[]).includes(o.length as number) ? (o.length as number) : DEFAULT_BOOKING.length;
  const gap = (GAPS as readonly number[]).includes(o.gap as number) ? (o.gap as number) : DEFAULT_BOOKING.gap;
  if (!days.length || start >= end) return { ...DEFAULT_BOOKING, length, gap };
  return { days, start, end, length, gap };
}

/** A problem with rules the person entered, in one line, or null when they're fine. */
export function bookingProblem(b: Booking): string | null {
  if (!b.days.length) return "Pick at least one day.";
  if (b.start >= b.end) return "The end time has to be after the start time.";
  return null;
}

const time = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

/** "Monday to Friday" or "Monday, Wednesday and Friday". */
export function daysText(days: number[]): string {
  const d = [...days].sort();
  const run = d.length > 2 && d.every((x, i) => i === 0 || x === d[i - 1] + 1);
  if (run) return `${DAY_NAMES[d[0] - 1]} to ${DAY_NAMES[d[d.length - 1] - 1]}`;
  const names = d.map((x) => DAY_NAMES[x - 1]);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : (names[0] ?? "");
}

/** The rule line Hora gets in her instructions. */
export function bookingLine(b: Booking, timezone?: string | null): string {
  return `Booking rules from the owner: book meetings ${daysText(b.days)}, ${time(b.start)} to ${time(b.end)}${timezone ? ` (${timezone} time)` : ""}. Meetings are ${b.length} minutes${b.gap ? `, with ${b.gap} minutes between them` : ""}. Never book outside these rules unless the person asks.`;
}
