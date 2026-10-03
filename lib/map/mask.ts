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
