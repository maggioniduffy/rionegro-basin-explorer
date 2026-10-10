/**
 * Opacity of the mask over basin land outside the visible land: translucent, so that
 * land shows dimmed instead of disappearing (owner, 2026-10-03). Keep it above the 0.5
 * that MapView's `maskedAt` reads as covered, or features under masked land become
 * clickable. Outside the basin the mask stays opaque (`maskLayerOpacities`).
 */
export const MASKED_LAND_OPACITY = 0.7;

/**
 * Visible Land slider → opacity of each mask level.
 *
 * Levels are discrete polygons (level k reveals more land than k − 1). For a slider
 * value v between levels i and i + 1, level i is drawn at d·(1 − (v − i)) and level
 * i + 1 under it at whatever makes the two together d (d = `landOpacity`). Land inside
 * hole i stays clear, land outside hole i + 1 stays at d, and the band in between
 * fades from d to clear as v grows, so dragging looks continuous with only two
 * polygons drawn.
 */
export function maskOpacities(
  value: number,
  levelCount: number,
  landOpacity = MASKED_LAND_OPACITY,
): number[] {
  const max = levelCount - 1;
  const v = Math.min(Math.max(value, 0), max);
  const i = Math.min(Math.floor(v), max);
  const t = v - i;
  const opacities = Array.from({ length: levelCount }, () => 0);
  const own = i === max ? landOpacity : landOpacity * (1 - t);
  opacities[i] = own;
  // Land outside hole i + 1 lies under both levels: 1 − (1 − a)(1 − own) = d.
  if (i < max)
    opacities[i + 1] = own >= 1 ? 1 : 1 - (1 - landOpacity) / (1 - own);
  return opacities;
}

/**
 * The mask layers' opacities. Every level also covers everything outside the basin
 * (pipeline:mask: bounds minus the hole), and the last level's hole is the whole basin,
 * so that layer covers only the outside and is kept opaque: the imagery source is
 * clipped to the basin's bbox, not its outline, and must not show past the basin.
 */
export function maskLayerOpacities(
  value: number,
  levelCount: number,
  landOpacity = MASKED_LAND_OPACITY,
): number[] {
  const opacities = maskOpacities(value, levelCount, landOpacity);
  opacities[levelCount - 1] = 1;
  return opacities;
}

/**
 * Share of the basin's area visible at each Visible Land level, from
 * data/work/mask/report.json (`levels[].visible km² / basinKm2`, basin 136 202 km²).
 * Regenerate with pipeline:mask if the buffer widths change.
 */
const LEVEL_KM2 = [8708, 14329, 25079, 44816, 76782, 136202];
export const LEVEL_VISIBLE_SHARE = LEVEL_KM2.map(
  (km2) => km2 / (LEVEL_KM2.at(-1) ?? 1),
);

/** Bar position of each level: its visible share, rescaled so level 0 sits at 0. */
const FIRST_SHARE = LEVEL_VISIBLE_SHARE[0] ?? 0;
const LEVEL_POSITIONS = LEVEL_VISIBLE_SHARE.map(
  (s) => (s - FIRST_SHARE) / (1 - FIRST_SHARE),
);

/**
 * Slider position (0 … 1) → Visible Land level. The slider is linear in visible area,
 * not in level: levels grow geometrically, so a level-linear bar spends its first
 * quarter on the 6–11 % of the basin that look alike. Between two levels the value
 * interpolates by area, so the thumb at 50 % shows about half the basin (level 0 sits
 * at the left end, so the bar spans 6 %–100 %).
 */
export function positionToLevel(
  position: number,
  positions: readonly number[] = LEVEL_POSITIONS,
): number {
  const p = Math.min(Math.max(position, 0), 1);
  for (let i = 1; i < positions.length; i++) {
    const lo = positions[i - 1] ?? 0;
    const hi = positions[i] ?? 1;
    if (p <= hi) return i - 1 + (p - lo) / (hi - lo);
  }
  return positions.length - 1;
}

/** Inverse of `positionToLevel`. */
export function levelToPosition(
  level: number,
  positions: readonly number[] = LEVEL_POSITIONS,
): number {
  const max = positions.length - 1;
  const v = Math.min(Math.max(level, 0), max);
  const i = Math.min(Math.floor(v), max - 1);
  const lo = positions[i] ?? 0;
  const hi = positions[i + 1] ?? 1;
  return lo + (v - i) * (hi - lo);
}
