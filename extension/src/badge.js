// The number on the toolbar icon: approvals waiting for a person in the picked workspace.

export const BADGE_COLOR = "#C6613F";

/** The badge text for a count: nothing for 0 (or a bad count), the number up to 99, then "99+". */
export function badgeText(count) {
  const n = Number(count);
  if (!Number.isFinite(n) || n < 1) return "";
  return n > 99 ? "99+" : String(Math.floor(n));
}

/** The tooltip on the toolbar icon. */
export function badgeTitle(count) {
  const n = Number(count);
  if (!Number.isFinite(n) || n < 1) return "Morning Telos";
  return `Morning Telos: ${n > 99 ? "99+" : Math.floor(n)} waiting for your OK`;
}
