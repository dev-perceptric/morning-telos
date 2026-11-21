// Dates for the work tabs' calendars (Aphrodite's posts, later Hora's meetings). Weeks start on Monday. Pure: every
// function takes the dates it needs, in the browser's own time zone.

export const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

/** Midnight at the start of the day. */
export const startOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

/** The Monday of the week the day is in, at midnight. */
export const weekStart = (d: Date) => addDays(startOfDay(d), -((d.getDay() + 6) % 7));

export const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** The days a view shows, and the range to load for them (to is the midnight after the last day). */
export function viewDays(view: "week" | "month", cursor: Date): { days: Date[]; from: Date; to: Date; month: number | null } {
  if (view === "week") {
    const from = weekStart(cursor);
    const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
    return { days, from, to: addDays(from, 7), month: null };
  }
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const from = weekStart(first);
  const days = Array.from({ length: 42 }, (_, i) => addDays(from, i));
  return { days, from, to: addDays(from, 42), month: first.getMonth() };
}

/** The view one step back or forward. */
export const step = (view: "week" | "month", cursor: Date, n: number) =>
  view === "week" ? addDays(weekStart(cursor), 7 * n) : new Date(cursor.getFullYear(), cursor.getMonth() + n, 1);

/** "Nov 16 to Nov 22" for a week, "November 2026" for a month. */
export function viewTitle(view: "week" | "month", cursor: Date): string {
  if (view === "month") return cursor.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const from = weekStart(cursor);
  const f = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${f(from)} to ${f(addDays(from, 6))}`;
}

/** "9:00 AM" */
export const timeOf = (d: Date) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/** The <input type="date"> and <input type="time"> values for a moment, in local time. */
export function inputsOf(d: Date): { day: string; time: string } {
  const p = (n: number) => String(n).padStart(2, "0");
  return { day: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, time: `${p(d.getHours())}:${p(d.getMinutes())}` };
}

/** The moment from those inputs, as an ISO time, or null when either is empty or wrong. */
export function fromInputs(day: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const d = new Date(`${day}T${time}:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
