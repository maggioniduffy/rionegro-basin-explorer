/** Bottom sheet (phones): the heights it rests at. */
export const SHEET_SNAPS = ["peek", "half", "full"] as const;
export type SheetSnap = (typeof SHEET_SNAPS)[number];

/** Height of the closed sheet: drag handle and tab row. */
export const SHEET_PEEK_PX = 76;

/**
 * Resting heights in px. Full stops below the header and leaves room above the sheet
 * for the map attribution, which the imagery licence wants visible.
 */
export function sheetHeights(o: {
  viewport: number;
  top: number;
  attribution: number;
}): Record<SheetSnap, number> {
  const full = Math.max(SHEET_PEEK_PX, o.viewport - o.top - o.attribution);
  return {
    peek: SHEET_PEEK_PX,
    half: Math.min(full, Math.max(SHEET_PEEK_PX, Math.round(o.viewport / 2))),
    full,
  };
}

/** The resting height closest to where a drag ended. */
export function nearestSnap(
  height: number,
  heights: Record<SheetSnap, number>,
): SheetSnap {
  return SHEET_SNAPS.reduce((best, s) =>
    Math.abs(heights[s] - height) < Math.abs(heights[best] - height) ? s : best,
  );
}

/** Opening something to read (a selection) shows at least half the sheet. */
export const atLeastHalf = (s: SheetSnap): SheetSnap =>
  s === "peek" ? "half" : s;
