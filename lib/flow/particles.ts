import {
  FLOW_LATERAL_JITTER,
  FLOW_MAX_DT_S,
  FLOW_MAX_PARTICLE_AGE_S,
  FLOW_REFERENCE_LENGTH_M,
  FLOW_RESERVOIR_JITTER,
  FLOW_RESERVOIR_SPEED,
  FLOW_TRAIL,
  FLOW_TRAIL_DT_S,
  FLOW_TRAVERSAL_S,
  FLOW_U_LIMIT,
} from "./config";
import { positionAtInto, type Track } from "./geometry";
import { insideReservoir, type FlowNetwork } from "./network";
import { branchSpeed, relativeSpeed } from "./speed";

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
  /** Simulated seconds accumulated since the last trail sample was committed. */
  trailClock: number;
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
    trailClock: 0,
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
  // A new trail sample is committed every FLOW_TRAIL_DT_S of simulated time; in between the
  // head slot is overwritten with the live position, so the newest point is always current.
  state.trailClock += step * multiplier;
  if (state.trailClock >= FLOW_TRAIL_DT_S) {
    state.trailClock %= FLOW_TRAIL_DT_S;
    state.head = (state.head + 1) % FLOW_TRAIL;
  }
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

// ---------------------------------------------------------------------------------------
// Network mode (F3): particles on a branch network. The F1 functions above are untouched.
// ---------------------------------------------------------------------------------------

/**
 * ParticleState plus the network position: mode >= 0 is a branch index (s, u as in F1),
 * mode = -1 - r is reservoir r, where the position is x, y (origin-relative Mercator, the
 * network's shared frame). trail/head/v/age work as in F1, so fillSegments takes it as is.
 */
export interface NetParticleState extends ParticleState {
  mode: Int16Array;
  x: Float64Array;
  y: Float64Array;
}

function placeNet(state: NetParticleState, net: FlowNetwork, p: number): void {
  const m = state.mode[p]!;
  if (m >= 0) {
    positionAtInto(net.tracks[m]!, state.s[p]!, state.u[p]!, state.scratch);
    state.v[p] = branchSpeed(net, m, state.s[p]!, state.u[p]!);
  } else {
    state.scratch[0] = state.x[p]!;
    state.scratch[1] = state.y[p]!;
    state.v[p] = FLOW_RESERVOIR_SPEED;
  }
}

/** Index in the cumulative seed table (branches first, then reservoirs) for u in [0, 1). */
function pickSeed(net: FlowNetwork, r: number): number {
  const c = net.seedCum;
  let lo = 0;
  let hi = c.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (c[mid]! > r) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** Seeded rejection sampling inside the reservoir; falls back to its anchor point. */
function seedInReservoir(
  state: NetParticleState,
  net: FlowNetwork,
  p: number,
  ri: number,
  rng: () => number,
): void {
  const res = net.reservoirs[ri]!;
  const b = res.bbox;
  for (let attempt = 0; attempt < 32; attempt++) {
    const x = b[0] + rng() * (b[2] - b[0]);
    const y = b[1] + rng() * (b[3] - b[1]);
    if (insideReservoir(res, x, y)) {
      state.x[p] = x;
      state.y[p] = y;
      return;
    }
  }
  state.x[p] = res.fallbackX;
  state.y[p] = res.fallbackY;
}

function respawnNet(
  state: NetParticleState,
  net: FlowNetwork,
  p: number,
  rng: () => number,
): void {
  const nB = net.tracks.length;
  const target = pickSeed(net, rng());
  if (target < nB) {
    state.mode[p] = target;
    state.s[p] = rng() * net.tracks[target]!.length;
    state.u[p] = (rng() * 2 - 1) * FLOW_U_LIMIT;
  } else {
    const ri = target - nB;
    state.mode[p] = -1 - ri;
    state.s[p] = 0;
    state.u[p] = 0;
    seedInReservoir(state, net, p, ri, rng);
  }
  state.age[p] = 0;
  state.maxAge[p] = FLOW_MAX_PARTICLE_AGE_S * (0.5 + 0.5 * rng());
  placeNet(state, net, p);
  for (let k = 0; k < FLOW_TRAIL; k++) writeTrail(state, p, k);
}

export function createNetParticles(
  net: FlowNetwork,
  count: number,
  rng: () => number,
): NetParticleState {
  // Nothing to seed (no flowing branch, no reservoir): an empty state, not a crash.
  const n = net.seedCum.length > 0 ? count : 0;
  const state: NetParticleState = {
    count: n,
    s: new Float64Array(n),
    u: new Float64Array(n),
    age: new Float32Array(n),
    maxAge: new Float32Array(n),
    v: new Float32Array(n),
    trail: new Float32Array(n * FLOW_TRAIL * 2),
    head: 0,
    trailClock: 0,
    scratch: new Float64Array(2),
    mode: new Int16Array(n),
    x: new Float64Array(n),
    y: new Float64Array(n),
  };
  for (let p = 0; p < n; p++) {
    respawnNet(state, net, p, rng);
    state.age[p] = rng() * state.maxAge[p]!;
  }
  return state;
}

/** Most branches a single step may cross (very short branches); beyond it the particle respawns. */
const MAX_HANDOFFS = 8;

/** Picks an out-branch of node by cumulative share, or -1 if it has none. */
function pickOut(net: FlowNetwork, node: number, rng: () => number): number {
  const a = net.outStart[node]!;
  const z = net.outStart[node + 1]!;
  if (z === a) return -1;
  const r = rng();
  for (let k = a; k < z - 1; k++)
    if (r < net.outCum[k]!) return net.outBranch[k]!;
  return net.outBranch[z - 1]!;
}

/**
 * Advances every particle by dt seconds at a playback multiplier. Branches move as in F1;
 * at a branch end the particle enters the node's reservoir (inlet), else an out-branch by
 * share, else (sink) respawns. In a reservoir it drifts at FLOW_RESERVOIR_SPEED with a
 * seeded heading jitter, stays inside the polygon, and leaves through an open outlet.
 * Hand-offs keep the trail (it continues across the junction). No allocation per call.
 */
export function stepNetParticles(
  state: NetParticleState,
  net: FlowNetwork,
  dt: number,
  multiplier: number,
  rng: () => number,
): void {
  const step = Math.min(Math.max(dt, 0), FLOW_MAX_DT_S);
  const baseline = FLOW_REFERENCE_LENGTH_M / FLOW_TRAVERSAL_S;
  const sim = step * multiplier;
  const jitter = FLOW_LATERAL_JITTER * Math.sqrt(sim);
  state.trailClock += sim;
  if (state.trailClock >= FLOW_TRAIL_DT_S) {
    state.trailClock %= FLOW_TRAIL_DT_S;
    state.head = (state.head + 1) % FLOW_TRAIL;
  }
  for (let p = 0; p < state.count; p++) {
    state.age[p] = state.age[p]! + sim;
    if (state.age[p]! >= state.maxAge[p]!) {
      respawnNet(state, net, p, rng);
      continue;
    }
    let m = state.mode[p]!;
    let alive = true;
    if (m >= 0) {
      state.s[p] = state.s[p]! + state.v[p]! * baseline * sim;
      const u = state.u[p]! + (rng() * 2 - 1) * jitter;
      state.u[p] = Math.min(FLOW_U_LIMIT, Math.max(-FLOW_U_LIMIT, u));
      for (
        let guard = 0;
        m >= 0 && state.s[p]! >= net.tracks[m]!.length;
        guard++
      ) {
        if (guard >= MAX_HANDOFFS) {
          alive = false;
          break;
        }
        const node = net.branchTo[m]!;
        const over = state.s[p]! - net.tracks[m]!.length;
        const ri = net.nodeInlet[node]!;
        if (ri >= 0) {
          m = -1 - ri;
          state.mode[p] = m;
          state.x[p] = net.nodeX[node]!;
          state.y[p] = net.nodeY[node]!;
          state.s[p] = 0;
          break;
        }
        const next = pickOut(net, node, rng);
        if (next < 0) {
          alive = false;
          break;
        }
        m = next;
        state.mode[p] = m;
        state.s[p] = over;
      }
    } else {
      alive = stepInReservoir(state, net, p, -1 - m, sim, baseline, rng);
    }
    if (!alive) {
      respawnNet(state, net, p, rng);
      continue;
    }
    placeNet(state, net, p);
    writeTrail(state, p, state.head);
  }
}

/** One reservoir step; returns false if the particle must respawn. */
function stepInReservoir(
  state: NetParticleState,
  net: FlowNetwork,
  p: number,
  ri: number,
  sim: number,
  baseline: number,
  rng: () => number,
): boolean {
  const res = net.reservoirs[ri]!;
  const len = FLOW_RESERVOIR_SPEED * baseline * sim * res.mPerUnit;
  const jx = (rng() * 2 - 1) * FLOW_RESERVOIR_JITTER * len;
  const jy = (rng() * 2 - 1) * FLOW_RESERVOIR_JITTER * len;
  const x = state.x[p]!;
  const y = state.y[p]!;
  let nx = x + res.driftX * len + jx;
  let ny = y + res.driftY * len + jy;
  if (!insideReservoir(res, nx, ny)) {
    nx = x + jx;
    ny = y + jy;
    if (!insideReservoir(res, nx, ny)) {
      nx = x;
      ny = y;
    }
  }
  state.x[p] = nx;
  state.y[p] = ny;
  for (let o = 0; o < res.outlets.length; o++) {
    const out = res.outlets[o]!;
    if (!out.open) continue;
    const dx = nx - out.x;
    const dy = ny - out.y;
    if (dx * dx + dy * dy > out.radius2) continue;
    const next = pickOut(net, out.node, rng);
    if (next < 0) continue;
    state.mode[p] = next;
    state.s[p] = 0;
    state.u[p] = (rng() * 2 - 1) * FLOW_U_LIMIT;
    return true;
  }
  return true;
}
