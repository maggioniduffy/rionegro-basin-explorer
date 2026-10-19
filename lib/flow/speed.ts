import { FLOW_RATIO_CLAMP } from "./config";
import { meanWidth, widthAt, type Track } from "./geometry";
import type { FlowNetwork } from "./network";

/**
 * Relative, illustrative speed (owner decision F1): no source holds velocity, so the model
 * combines a lateral profile (fastest mid-channel) with continuity at constant depth
 * (narrower channel, faster water). The section maximum is 1; no m/s is ever shown.
 */

/** Lateral profile across the channel, u in [-1, 1]: 1 at the centre, 0 at the banks. */
export function lateralProfile(u: number): number {
  return 1 - Math.abs(u) ** 4;
}

function clampRatio(r: number): number {
  const [lo, hi] = FLOW_RATIO_CLAMP;
  if (!Number.isFinite(r)) return r > 0 ? hi : 1;
  return Math.min(hi, Math.max(lo, r));
}

/** Mean width over local width, clamped. */
export function widthRatio(track: Track, s: number): number {
  const w = widthAt(track, s);
  const mean = meanWidth(track);
  if (w <= 0) return mean > 0 ? FLOW_RATIO_CLAMP[1] : 1;
  return clampRatio(mean / w);
}

// The maximum ratio depends only on the track; cache it so per-particle calls stay cheap.
const maxRatioCache = new WeakMap<Track, number>();

/** Largest width ratio over the stations (the normaliser, so the section maximum is 1). */
export function maxRatio(track: Track): number {
  const cached = maxRatioCache.get(track);
  if (cached !== undefined) return cached;
  let max = 0;
  for (let i = 0; i < track.s.length; i++) {
    const r = widthRatio(track, track.s[i]!);
    if (r > max) max = r;
  }
  if (max <= 0) max = 1;
  maxRatioCache.set(track, max);
  return max;
}

/** Relative speed in [0, 1] at (s, u). */
export function relativeSpeed(track: Track, s: number, u: number): number {
  const v = (lateralProfile(u) * widthRatio(track, s)) / maxRatio(track);
  return Math.min(1, Math.max(0, v));
}

/**
 * Unnormalised centreline speed factor of a network branch at s: flux / local width with the
 * width clamped like widthRatio (flux x clampedRatio / mean width), or the plain clamped
 * width ratio when the network has no flux.
 */
export function branchSpeedFactor(
  track: Track,
  meanW: number,
  flux: number,
  useFlux: boolean,
  s: number,
): number {
  const w = widthAt(track, s);
  const ratio = w <= 0 ? FLOW_RATIO_CLAMP[1] : clampRatio(meanW / w);
  if (!useFlux) return meanW > 0 ? ratio : 1;
  return meanW > 0 ? (flux * ratio) / meanW : 0;
}

/**
 * Relative speed in [0, 1] on network branch b at (s, u): lateral profile times the branch
 * factor, normalised so the network maximum (u = 0, over every branch vertex) is 1. Same
 * illustrative model as relativeSpeed (no velocity in any source).
 */
export function branchSpeed(
  net: FlowNetwork,
  b: number,
  s: number,
  u: number,
): number {
  const f = branchSpeedFactor(
    net.tracks[b]!,
    net.branchMeanW[b]!,
    net.branchFlux[b]!,
    net.useFlux,
    s,
  );
  const v = (lateralProfile(u) * f) / net.speedNorm;
  return Math.min(1, Math.max(0, v));
}
