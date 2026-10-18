import { describe, expect, it } from "vitest";
import { FLOW_COLOR_STOPS, speedColor } from "@/lib/flow/color";
import { FLOW_PARTICLES, FLOW_U_LIMIT } from "@/lib/flow/config";
import {
  buildTrack,
  inChannel,
  metresToMercator,
  positionAt,
} from "@/lib/flow/geometry";
import {
  createParticles,
  hashSeed,
  mulberry32,
  stepParticles,
} from "@/lib/flow/particles";
import type { FlowSection } from "@/lib/flow/schema";

/** Two stations heading east, channel 100 m to each side of the centerline. */
function eastTrack() {
  const lat = -40;
  const dLon = 0.002;
  const section = {
    stations: {
      lon: [-70, -70 + dLon],
      lat: [lat, lat],
      nMin: [-100, -100],
      nMax: [100, 100],
      src: [0, 0],
      gap: [0, 0],
    },
  } as unknown as FlowSection;
  return buildTrack(section);
}

describe("track parametrisation", () => {
  it("puts u=0 at the midpoint and u=+1 north of an eastward track at nMax", () => {
    const t = eastTrack();
    const mid = positionAt(t, t.length / 2, 0);
    expect(mid[0]!).toBeCloseTo(t.x[1]! / 2, 12);
    expect(mid[1]).toBeCloseTo(0, 12);
    const left = positionAt(t, t.length / 2, 1);
    expect(left[0]!).toBeCloseTo(t.x[1]! / 2, 12);
    // y grows south, so north (left of eastward) is negative y.
    expect(left[1]).toBeCloseTo(-100 * metresToMercator(-40), 10);
  });

  it("clips by the channel bounds", () => {
    const t = eastTrack();
    expect(inChannel(t, t.length / 2, 50)).toBe(true);
    expect(inChannel(t, t.length / 2, 101)).toBe(false);
    expect(inChannel(t, t.length / 2, -101)).toBe(false);
  });
});

describe("speedColor", () => {
  it("hits the end stops and clamps", () => {
    const first = speedColor(0);
    const last = speedColor(1);
    const hex = (h: string) =>
      [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
    expect(first).toEqual(hex(FLOW_COLOR_STOPS[0]!.hex));
    expect(last).toEqual(
      hex(FLOW_COLOR_STOPS[FLOW_COLOR_STOPS.length - 1]!.hex),
    );
    expect(speedColor(1.5)).toEqual(last);
  });
});

describe("particles", () => {
  it("is deterministic and stays inside the section", () => {
    const track = eastTrack();
    const run = () => {
      const rng = mulberry32(hashSeed("limay-010"));
      const state = createParticles(track, 200, rng);
      for (let i = 0; i < 50; i++) stepParticles(state, track, 0.05, 1, rng);
      return state;
    };
    const a = run();
    const b = run();
    expect(Array.from(a.s)).toEqual(Array.from(b.s));
    expect(Array.from(a.trail)).toEqual(Array.from(b.trail));
    for (let p = 0; p < a.count; p++) {
      expect(Math.abs(a.u[p]!)).toBeLessThanOrEqual(FLOW_U_LIMIT);
      expect(a.s[p]).toBeGreaterThanOrEqual(0);
      expect(a.s[p]).toBeLessThan(track.length);
    }
    expect(FLOW_PARTICLES).toBeGreaterThan(0);
  });
});
