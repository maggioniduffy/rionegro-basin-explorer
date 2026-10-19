/**
 * Flow close-up constants (phase F1). Values marked provisional are display choices to tune
 * on screen in F1.3; none of them is a measured quantity (speed is relative by design).
 */

/** Particles per section. Provisional. */
export const FLOW_PARTICLES = 3000;

/** Trail length in world positions per particle. Provisional. */
export const FLOW_TRAIL = 8;

/** Simulated seconds between trail samples (a trail spans FLOW_TRAIL x this). Provisional. */
export const FLOW_TRAIL_DT_S = 0.06;

/** Seconds for a particle at relative speed 1 to cross a 4 km section at 1x. Provisional. */
export const FLOW_TRAVERSAL_S = 30;

/** Length of the section the traversal time refers to, in metres (sections are 3-5 km). */
export const FLOW_REFERENCE_LENGTH_M = 4000;

/** Playback multipliers offered in the UI. */
export const FLOW_SPEEDS = [0.5, 1, 2, 4] as const;

/** Flow mode starts below this zoom (a 4 km window fits at about z14). Provisional. */
export const FLOW_MIN_ZOOM = 12;

/** Zoom range over which the particle layer fades in at FLOW_MIN_ZOOM. Provisional. */
export const FLOW_FADE_ZOOMS = 0.5;

/** Map max zoom while flow mode is on (owner decision F1; 13 is restored on exit). */
export const FLOW_MAXZOOM = 14.5;

/** Longest a particle lives before it respawns, in seconds. Provisional. */
export const FLOW_MAX_PARTICLE_AGE_S = 40;

/** Clamp of the width ratio (mean width / local width) in the speed model. Provisional. */
export const FLOW_RATIO_CLAMP = [0.5, 2] as const;

/** Largest simulation step in seconds, so a long frame does not teleport particles. */
export const FLOW_MAX_DT_S = 0.1;

/** Lateral random walk strength (in u units per sqrt(second)). Provisional. */
export const FLOW_LATERAL_JITTER = 0.2;

/** Particles never leave |u| <= this, so they stay inside the channel edge. */
export const FLOW_U_LIMIT = 0.98;

/**
 * Network mode (F3). All four values below are illustrative display choices, not measured.
 * Share of the particles seeded in reservoirs when the net also has branches (split by area).
 */
export const FLOW_RESERVOIR_SEED_SHARE = 0.4;

/** Reservoir drift speed relative to the network maximum (same m/s scale as branches). */
export const FLOW_RESERVOIR_SPEED = 0.08;

/** Heading jitter of a reservoir particle, as a fraction of its drift speed per axis. */
export const FLOW_RESERVOIR_JITTER = 0.5;

/** A reservoir particle enters an outlet branch within max(this, 1.5 x its half width) of the node. */
export const FLOW_RESERVOIR_OUTLET_MIN_M = 30;
export const FLOW_RESERVOIR_OUTLET_HW_FACTOR = 1.5;
