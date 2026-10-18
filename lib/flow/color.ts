/** Speed colour ramp (relative speed 0..1), chosen to read on dark satellite imagery. */

export const FLOW_COLOR_STOPS: readonly { at: number; hex: string }[] = [
  { at: 0, hex: "#3d5bff" }, // blue
  { at: 0.25, hex: "#22d3ee" }, // cyan
  { at: 0.5, hex: "#4ade80" }, // green
  { at: 0.75, hex: "#facc15" }, // yellow
  { at: 1, hex: "#f43f9e" }, // magenta
];

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const RGB = FLOW_COLOR_STOPS.map((s) => hexToRgb(s.hex));

/** [r, g, b] in 0..1 for relative speed v (clamped to [0, 1]), linear between stops. */
export function speedColor(
  v: number,
  out: [number, number, number] = [0, 0, 0],
): [number, number, number] {
  const c = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
  let k = 0;
  while (k < FLOW_COLOR_STOPS.length - 2 && c > FLOW_COLOR_STOPS[k + 1]!.at)
    k++;
  const a = FLOW_COLOR_STOPS[k]!;
  const b = FLOW_COLOR_STOPS[k + 1]!;
  const t = (c - a.at) / (b.at - a.at);
  for (let j = 0; j < 3; j++)
    out[j] = RGB[k]![j]! + (RGB[k + 1]![j]! - RGB[k]![j]!) * t;
  return out;
}

/** CSS gradient for the legend, from the same stops. */
export function legendGradient(): string {
  const stops = FLOW_COLOR_STOPS.map((s) => `${s.hex} ${s.at * 100}%`).join(
    ", ",
  );
  return `linear-gradient(to right, ${stops})`;
}
