import {
  FLOW_LATERAL_JITTER,
  FLOW_MAX_DT_S,
  FLOW_MAX_PARTICLE_AGE_S,
  FLOW_REFERENCE_LENGTH_M,
  FLOW_TRAIL,
  FLOW_TRAVERSAL_S,
  FLOW_U_LIMIT,
} from "./config";
import { positionAtInto, type Track } from "./geometry";
import { relativeSpeed } from "./speed";

/** Deterministic 32-bit PRNG returning floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a hash of a string to an unsigned 32-bit seed. */
export function hashSeed(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface ParticleState {
  count: number;
  /** Distance along the track (m) and lateral coordinate in [-1, 1]. */
  s: Float64Array;
  u: Float64Array;
  /** Seconds since spawn, and lifetime in seconds. */
  age: Float32Array;
  maxAge: Float32Array;
  /** Relative speed at the current position, 0..1 (drives colour). */
  v: Float32Array;
  /** count x FLOW_TRAIL x 2 positions relative to the track origin (ring buffer per particle). */
  trail: Float32Array;
  /** Slot of the newest trail position (shared by all particles). */
  head: number;
  /** Scratch for a position, reused every frame. */
  scratch: Float64Array;
}

function place(state: ParticleState, track: Track, p: number): void {
  positionAtInto(track, state.s[p]!, state.u[p]!, state.scratch);
  state.v[p] = relativeSpeed(track, state.s[p]!, state.u[p]!);
}

function writeTrail(state: ParticleState, p: number, slot: number): void {
  const o = (p * FLOW_TRAIL + slot) * 2;
  state.trail[o] = state.scratch[0]!;
  state.trail[o + 1] = state.scratch[1]!;
}

/** Respawns particle p uniformly in the channel; the trail collapses onto it (no streak). */
function respawn(
  state: ParticleState,
  track: Track,
  p: number,
  rng: () => number,
): void {
  state.s[p] = rng() * track.length;
  state.u[p] = (rng() * 2 - 1) * FLOW_U_LIMIT;
  state.age[p] = 0;
  state.maxAge[p] = FLOW_MAX_PARTICLE_AGE_S * (0.5 + 0.5 * rng());
  place(state, track, p);
  for (let k = 0; k < FLOW_TRAIL; k++) writeTrail(state, p, k);
}

export function createParticles(
  track: Track,
  count: number,
  rng: () => number,
): ParticleState {
  const state: ParticleState = {
    count,
    s: new Float64Array(count),
    u: new Float64Array(count),
    age: new Float32Array(count),
    maxAge: new Float32Array(count),
    v: new Float32Array(count),
    trail: new Float32Array(count * FLOW_TRAIL * 2),
    head: 0,
    scratch: new Float64Array(2),
  };
  for (let p = 0; p < count; p++) {
    respawn(state, track, p, rng);
    // Stagger ages so respawns do not happen in waves.
    state.age[p] = rng() * state.maxAge[p]!;
  }
  return state;
}

/**
 * Advances every particle by dt seconds at a playback multiplier. Along-track speed is the
 * relative speed times a fixed metres-per-second baseline (a 4 km section in
 * FLOW_TRAVERSAL_S at v = 1), the same for every section length.
 */
export function stepParticles(
  state: ParticleState,
  track: Track,
  dt: number,
  multiplier: number,
  rng: () => number,
): void {
  const step = Math.min(Math.max(dt, 0), FLOW_MAX_DT_S);
  const baseline = FLOW_REFERENCE_LENGTH_M / FLOW_TRAVERSAL_S;
  const jitter = FLOW_LATERAL_JITTER * Math.sqrt(step * multiplier);
  state.head = (state.head + 1) % FLOW_TRAIL;
  for (let p = 0; p < state.count; p++) {
    state.age[p] = state.age[p]! + step * multiplier;
    state.s[p] = state.s[p]! + state.v[p]! * baseline * step * multiplier;
    const u = state.u[p]! + (rng() * 2 - 1) * jitter;
    state.u[p] = Math.min(FLOW_U_LIMIT, Math.max(-FLOW_U_LIMIT, u));
    if (state.s[p]! >= track.length || state.age[p]! >= state.maxAge[p]!) {
      respawn(state, track, p, rng);
      continue;
    }
    place(state, track, p);
    writeTrail(state, p, state.head);
  }
}

/** Floats per vertex written by fillSegments: x, y, speed, alpha. */
export const FLOW_VERTEX_FLOATS = 4;

/**
 * Writes line-segment vertices (x, y, speed, alpha) for every consecutive trail pair, oldest
 * to newest, alpha rising to 1 at the head. Returns the vertex count; out must hold
 * count x (FLOW_TRAIL - 1) x 2 x 4 floats.
 */
export function fillSegments(state: ParticleState, out: Float32Array): number {
  let w = 0;
  for (let p = 0; p < state.count; p++) {
    const v = state.v[p]!;
    // Short fade-in after a respawn so particles do not pop.
    const life = Math.min(1, state.age[p]! / 0.5);
    for (let k = 0; k < FLOW_TRAIL - 1; k++) {
      const a = (state.head + 1 + k) % FLOW_TRAIL;
      const b = (a + 1) % FLOW_TRAIL;
      const oa = (p * FLOW_TRAIL + a) * 2;
      const ob = (p * FLOW_TRAIL + b) * 2;
      out[w++] = state.trail[oa]!;
      out[w++] = state.trail[oa + 1]!;
      out[w++] = v;
      out[w++] = (k / (FLOW_TRAIL - 1)) * life;
      out[w++] = state.trail[ob]!;
      out[w++] = state.trail[ob + 1]!;
      out[w++] = v;
      out[w++] = ((k + 1) / (FLOW_TRAIL - 1)) * life;
    }
  }
  return w / FLOW_VERTEX_FLOATS;
}
