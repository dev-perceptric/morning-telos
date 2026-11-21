// Where a small menu opens next to its button, on the page itself (position: fixed), so no scrolling box or sticky
// header can cover it. Below the button when it fits or when there's more room there, above otherwise, and never past
// the window's edges.

export const MENU_MAX = 320;
export const MENU_WIDTH = 240;
const GAP = 4;
const EDGE = 8;

type Rect = { top: number; bottom: number; left: number };
export type MenuPlace = { position: "fixed"; left: number; top?: number; bottom?: number; maxHeight: number };

export function menuPlace(btn: Rect, width: number, height: number, want = MENU_MAX): MenuPlace {
  const below = height - btn.bottom - GAP - EDGE;
  const above = btn.top - GAP - EDGE;
  const left = Math.max(EDGE, Math.min(btn.left, width - MENU_WIDTH - EDGE));
  if (below >= Math.min(want, 200) || below >= above) return { position: "fixed", left, top: btn.bottom + GAP, maxHeight: Math.max(120, Math.min(want, below)) };
  return { position: "fixed", left, bottom: height - btn.top + GAP, maxHeight: Math.max(120, Math.min(want, above)) };
}
