/**
 * Visible Land slider → opacity of each mask level.
 *
 * Levels are discrete polygons (level k reveals more land than k − 1). For a slider
 * value v between levels i and i + 1, level i + 1 is drawn opaque and level i on top
 * of it at opacity 1 − (v − i). Land inside hole i stays clear, land outside hole
 * i + 1 stays black, and the band in between fades in as v grows, so dragging looks
 * continuous with only two polygons drawn.
 */
export function maskOpacities(value: number, levelCount: number): number[] {
  const max = levelCount - 1;
  const v = Math.min(Math.max(value, 0), max);
  const i = Math.min(Math.floor(v), max);
  const t = v - i;
  const opacities = Array.from({ length: levelCount }, () => 0);
  opacities[i] = i === max ? 1 : 1 - t;
  if (i < max) opacities[i + 1] = 1;
  return opacities;
}
