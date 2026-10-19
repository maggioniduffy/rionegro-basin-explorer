import type { FlowSection } from "./schema";

/**
 * Polyline parametrisation of a flow section. Everything is in Web Mercator units 0..1 like
 * MapLibre's MercatorCoordinate (x grows east, y grows SOUTH), in float64, and positions are
 * stored relative to the track origin so a float32 upload keeps its precision.
 */

const EARTH_CIRCUMFERENCE_M = 40075016.686;

export function lngLatToMercator(lon: number, lat: number): [number, number] {
  const x = (180 + lon) / 360;
  const y =
    (180 -
      (180 / Math.PI) *
        Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) /
    360;
  return [x, y];
}

/** Mercator units per metre at a latitude. */
export function metresToMercator(lat: number): number {
  return 1 / (EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180));
}

export interface Track {
  /** Mercator position of station 0; x and y are relative to it. */
  originX: number;
  originY: number;
  x: Float64Array;
  y: Float64Array;
  /**
   * Unit left normal in Mercator, from the central difference of the neighbouring stations
   * (Mercator is conformal, so it stays perpendicular). For a downstream direction (dx, dy)
   * with y growing south, rotating 90 degrees counter-clockwise on the map gives (dy, -dx):
   * heading east (1, 0) gives (0, -1), which is north, the left bank.
   */
  nx: Float64Array;
  ny: Float64Array;
  /** Cumulative distance along the track in metres. */
  s: Float64Array;
  /** Signed lateral bounds in metres (+ = left); gaps interpolated from neighbours, else 0. */
  nMin: Float64Array;
  nMax: Float64Array;
  /** Mercator units per metre at each station (named after the section schema's metres axis). */
  mPerUnit: Float64Array;
  /** Track length in metres. */
  length: number;
}

/** Replace nulls by linear interpolation between the nearest known values; 0 if none. */
function fillNulls(values: readonly (number | null)[]): Float64Array {
  const n = values.length;
  const out = new Float64Array(n);
  let prev = -1;
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (v === null || v === undefined) continue;
    out[i] = v;
    if (prev === -1) {
      for (let k = 0; k < i; k++) out[k] = v;
    } else if (i - prev > 1) {
      const a = out[prev]!;
      for (let k = prev + 1; k < i; k++)
        out[k] = a + ((v - a) * (k - prev)) / (i - prev);
    }
    prev = i;
  }
  if (prev !== -1) for (let k = prev + 1; k < n; k++) out[k] = out[prev]!;
  return out;
}

export function buildTrack(section: FlowSection): Track {
  const { lon, lat, nMin, nMax } = section.stations;
  return buildTrackFromLine(lon, lat, nMin, nMax);
}

/**
 * Track from a lon/lat polyline with signed lateral bounds in metres per vertex. The origin
 * is the Mercator position of the first vertex unless one is given (a network shares one
 * origin across all its branches).
 */
export function buildTrackFromLine(
  lon: readonly number[],
  lat: readonly number[],
  nMin: readonly (number | null)[],
  nMax: readonly (number | null)[],
  origin?: readonly [number, number],
): Track {
  const n = lon.length;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const mPerUnit = new Float64Array(n);
  const [originX, originY] = origin
    ? [origin[0], origin[1]]
    : n > 0
      ? lngLatToMercator(lon[0]!, lat[0]!)
      : [0, 0];
  for (let i = 0; i < n; i++) {
    const [mx, my] = lngLatToMercator(lon[i]!, lat[i]!);
    x[i] = mx - originX;
    y[i] = my - originY;
    mPerUnit[i] = metresToMercator(lat[i]!);
  }
  const nx = new Float64Array(n);
  const ny = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(n - 1, i + 1);
    const dx = x[b]! - x[a]!;
    const dy = y[b]! - y[a]!;
    const len = Math.hypot(dx, dy) || 1;
    nx[i] = dy / len;
    ny[i] = -dx / len;
  }
  const s = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const units = Math.hypot(x[i]! - x[i - 1]!, y[i]! - y[i - 1]!);
    s[i] = s[i - 1]! + units / ((mPerUnit[i]! + mPerUnit[i - 1]!) / 2);
  }
  return {
    originX,
    originY,
    x,
    y,
    nx,
    ny,
    s,
    nMin: fillNulls(nMin),
    nMax: fillNulls(nMax),
    mPerUnit,
    length: n > 0 ? s[n - 1]! : 0,
  };
}

/** Index i of the segment [i, i+1] holding s (clamped to the track), by binary search. */
export function segmentIndex(track: Track, s: number): number {
  let lo = 0;
  let hi = track.s.length - 2;
  if (hi < 0) return 0;
  if (s <= 0) return 0;
  if (s >= track.length) return hi;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (track.s[mid]! <= s) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Segment index and fraction t in [0, 1] of s along it. */
export function locate(track: Track, s: number): { i: number; t: number } {
  const i = segmentIndex(track, s);
  return { i, t: fractionIn(track, i, s) };
}

function fractionIn(track: Track, i: number, s: number): number {
  if (track.s.length < 2) return 0;
  const span = track.s[i + 1]! - track.s[i]!;
  if (span <= 0) return 0;
  return Math.min(1, Math.max(0, (s - track.s[i]!) / span));
}

/** Allocation-free positionAt: writes [x, y] (relative to the origin) into out. */
export function positionAtInto(
  track: Track,
  s: number,
  u: number,
  out: ArrayLike<number> & { [k: number]: number },
): void {
  const n = track.s.length;
  if (n === 0) {
    out[0] = 0;
    out[1] = 0;
    return;
  }
  if (n === 1) {
    const off =
      lerp(track.nMin[0]!, track.nMax[0]!, (u + 1) / 2) * track.mPerUnit[0]!;
    out[0] = track.x[0]! + track.nx[0]! * off;
    out[1] = track.y[0]! + track.ny[0]! * off;
    return;
  }
  const i = segmentIndex(track, s);
  const t = fractionIn(track, i, s);
  const cx = lerp(track.x[i]!, track.x[i + 1]!, t);
  const cy = lerp(track.y[i]!, track.y[i + 1]!, t);
  const nxs = lerp(track.nx[i]!, track.nx[i + 1]!, t);
  const nys = lerp(track.ny[i]!, track.ny[i + 1]!, t);
  const nl = Math.hypot(nxs, nys) || 1;
  const metres = lerp(
    lerp(track.nMin[i]!, track.nMin[i + 1]!, t),
    lerp(track.nMax[i]!, track.nMax[i + 1]!, t),
    (u + 1) / 2,
  );
  const k = metres * lerp(track.mPerUnit[i]!, track.mPerUnit[i + 1]!, t);
  out[0] = cx + (nxs / nl) * k;
  out[1] = cy + (nys / nl) * k;
}

/**
 * Position at distance s along the centerline with lateral coordinate u in [-1, 1]
 * (-1 = nMin edge, +1 = nMax edge), relative to the origin, in Mercator units.
 */
export function positionAt(
  track: Track,
  s: number,
  u: number,
): [number, number] {
  const out: [number, number] = [0, 0];
  positionAtInto(track, s, u, out);
  return out;
}

/**
 * Projects a point (relative to the origin, Mercator units) onto the nearest segment:
 * s along the track in metres and signed lateral distance n in metres (+ left).
 */
export function toSection(
  track: Track,
  px: number,
  py: number,
): { s: number; n: number } {
  const count = track.s.length;
  if (count === 0) return { s: 0, n: 0 };
  if (count === 1) {
    const dx = px - track.x[0]!;
    const dy = py - track.y[0]!;
    return {
      s: 0,
      n: (dx * track.nx[0]! + dy * track.ny[0]!) / track.mPerUnit[0]!,
    };
  }
  let best = Infinity;
  let bestI = 0;
  let bestT = 0;
  for (let i = 0; i < count - 1; i++) {
    const ax = track.x[i]!;
    const ay = track.y[i]!;
    const bx = track.x[i + 1]! - ax;
    const by = track.y[i + 1]! - ay;
    const len2 = bx * bx + by * by;
    let t = len2 > 0 ? ((px - ax) * bx + (py - ay) * by) / len2 : 0;
    t = Math.min(1, Math.max(0, t));
    const dx = px - (ax + bx * t);
    const dy = py - (ay + by * t);
    const d2 = dx * dx + dy * dy;
    if (d2 < best) {
      best = d2;
      bestI = i;
      bestT = t;
    }
  }
  const i = bestI;
  const t = bestT;
  const cx = lerp(track.x[i]!, track.x[i + 1]!, t);
  const cy = lerp(track.y[i]!, track.y[i + 1]!, t);
  const nxs = lerp(track.nx[i]!, track.nx[i + 1]!, t);
  const nys = lerp(track.ny[i]!, track.ny[i + 1]!, t);
  const nl = Math.hypot(nxs, nys) || 1;
  const mpu = lerp(track.mPerUnit[i]!, track.mPerUnit[i + 1]!, t);
  return {
    s: lerp(track.s[i]!, track.s[i + 1]!, t),
    n: ((px - cx) * nxs + (py - cy) * nys) / nl / mpu,
  };
}

/** Whether lateral offset n (metres, + left) at s lies between nMin(s) and nMax(s). */
export function inChannel(track: Track, s: number, n: number): boolean {
  const { lo, hi } = boundsAt(track, s);
  return n >= lo && n <= hi;
}

function boundsAt(track: Track, s: number): { lo: number; hi: number } {
  const count = track.s.length;
  if (count === 0) return { lo: 0, hi: 0 };
  if (count === 1) return { lo: track.nMin[0]!, hi: track.nMax[0]! };
  const i = segmentIndex(track, s);
  const t = fractionIn(track, i, s);
  return {
    lo: lerp(track.nMin[i]!, track.nMin[i + 1]!, t),
    hi: lerp(track.nMax[i]!, track.nMax[i + 1]!, t),
  };
}

/** Channel width in metres at s. */
export function widthAt(track: Track, s: number): number {
  const count = track.s.length;
  if (count === 0) return 0;
  if (count === 1) return track.nMax[0]! - track.nMin[0]!;
  const i = segmentIndex(track, s);
  const t = fractionIn(track, i, s);
  return lerp(
    track.nMax[i]! - track.nMin[i]!,
    track.nMax[i + 1]! - track.nMin[i + 1]!,
    t,
  );
}

/** Mean station width in metres. */
export function meanWidth(track: Track): number {
  const count = track.s.length;
  if (count === 0) return 0;
  let sum = 0;
  for (let i = 0; i < count; i++) sum += track.nMax[i]! - track.nMin[i]!;
  return sum / count;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
