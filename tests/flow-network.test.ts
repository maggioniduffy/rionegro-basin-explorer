import { describe, expect, it } from "vitest";
import { FLOW_U_LIMIT } from "@/lib/flow/config";
import { buildNetwork, insideReservoir } from "@/lib/flow/network";
import { encodeNet } from "@/lib/flow/net-pub";
import type { FlowNet } from "@/lib/flow/net-schema";
import {
  createNetParticles,
  hashSeed,
  mulberry32,
  stepNetParticles,
} from "@/lib/flow/particles";

const LON0 = -70;
const LAT0 = -40;
const MPD = 111195;
const ll = (x: number, y: number): [number, number] => [
  LON0 + x / (MPD * Math.cos((LAT0 * Math.PI) / 180)),
  LAT0 + y / MPD,
];

/**
 * Source A (index 0) splits 0.7 / 0.3 into arms B1 (1) and B2 (2) that rejoin, then C (3)
 * ends at the inlet of a 300 m x 200 m reservoir whose outlet feeds D (4). Metres east/north.
 */
function syntheticNet() {
  const nodePts: [number, number, FlowNet["nodes"][number]["kind"]][] = [
    [0, 0, "source"],
    [800, 0, "split"],
    [1200, 0, "join"],
    [1510, 0, "port"],
    [1780, 0, "port"],
    [2400, 0, "sink"],
  ];
  const nodes = nodePts.map(([x, y, kind], i) => {
    const [lon, lat] = ll(x, y);
    return {
      id: `n${i}`,
      lon,
      lat,
      s: x,
      kind,
      reservoir: i === 3 || i === 4 ? "r0" : null,
    };
  });
  const mk = (
    from: number,
    to: number,
    pts: [number, number][],
    share: number,
  ) => ({
    id: `b${from}-${to}-${share}`,
    from: `n${from}`,
    to: `n${to}`,
    kind: "channel" as const,
    lon: pts.map((p) => ll(...p)[0]),
    lat: pts.map((p) => ll(...p)[1]),
    halfWidthM: pts.map(() => 20),
    lengthM: 0,
    meanWidthM: 40,
    capacity: 1,
    share,
    flux: share,
    orient: "course" as const,
    narrow: false,
    s: [0, 0] as [number, number],
  });
  const ring = [
    [1500, -100],
    [1800, -100],
    [1800, 100],
    [1500, 100],
    [1500, -100],
  ].map(([x, y]) => ll(x!, y!));
  const net: FlowNet = {
    schema: "flow-net/1",
    id: "synthetic",
    region: "nqn",
    bbox: [LON0, LAT0 - 0.01, LON0 + 0.05, LAT0 + 0.01],
    source: {
      imagery: "",
      scenes: [],
      dates: ["", ""],
      dem: "",
      attribution: "",
    },
    model: { shares: "illustrative", capacityExponent: 1 },
    courseLengthM: 2400,
    nodes,
    branches: [
      mk(
        0,
        1,
        [
          [0, 0],
          [800, 0],
        ],
        1,
      ),
      mk(
        1,
        2,
        [
          [800, 0],
          [1000, 150],
          [1200, 0],
        ],
        0.7,
      ),
      mk(
        1,
        2,
        [
          [800, 0],
          [1000, -150],
          [1200, 0],
        ],
        0.3,
      ),
      mk(
        2,
        3,
        [
          [1200, 0],
          [1510, 0],
        ],
        1,
      ),
      mk(
        4,
        5,
        [
          [1780, 0],
          [2400, 0],
        ],
        1,
      ),
    ],
    reservoirs: [
      {
        id: "r0",
        rings: [ring],
        areaKm2: 0.06,
        inlets: ["n3"],
        outlets: [{ node: "n4", share: 1, flux: 1 }],
        drift: [1, 0],
        driftFrom: "ports",
        sRange: null,
      },
    ],
    qa: {
      courseCoverage: null,
      wetCourseCoverage: null,
      courseInWater: null,
      insideWater: null,
      f1InsideWater: null,
      cycles: 0,
      connectors: 0,
      parallelArms: 1,
      lakeIoU: null,
    },
  };
  return buildNetwork(encodeNet(net));
}

describe("flow network particles", () => {
  it("hands off at a split by share (0.7 / 0.3)", () => {
    const net = syntheticNet();
    const rng = mulberry32(hashSeed("split"));
    const state = createNetParticles(net, 600, rng);
    const prev = new Int16Array(state.count);
    const hits = [0, 0];
    for (let i = 0; i < 10000; i++) {
      prev.set(state.mode);
      stepNetParticles(state, net, 0.05, 2, rng);
      for (let p = 0; p < state.count; p++) {
        const m = state.mode[p]!;
        // A fresh respawn lands anywhere; a hand-off lands within one step of the arm start.
        if (prev[p] === 0 && (m === 1 || m === 2) && state.s[p]! < 15)
          hits[m - 1]!++;
      }
    }
    const total = hits[0]! + hits[1]!;
    expect(total).toBeGreaterThan(1000);
    expect(Math.abs(hits[0]! / total - 0.7)).toBeLessThan(0.03);
    expect(Math.abs(hits[1]! / total - 0.3)).toBeLessThan(0.03);
  });

  it("keeps particles in their branch or reservoir and exits through the outlet", () => {
    const net = syntheticNet();
    const rng = mulberry32(hashSeed("bounds"));
    const state = createNetParticles(net, 600, rng);
    const prev = new Int16Array(state.count);
    let exited = 0;
    let outside = 0;
    for (let i = 0; i < 4000; i++) {
      prev.set(state.mode);
      stepNetParticles(state, net, 0.05, 2, rng);
      for (let p = 0; p < state.count; p++) {
        const m = state.mode[p]!;
        if (prev[p]! < 0 && m === 4 && state.s[p] === 0) exited++;
        const ok =
          m >= 0
            ? Math.abs(state.u[p]!) <= FLOW_U_LIMIT &&
              state.s[p]! >= 0 &&
              state.s[p]! < net.tracks[m]!.length
            : insideReservoir(
                net.reservoirs[-1 - m]!,
                state.x[p]!,
                state.y[p]!,
              );
        if (!ok) outside++;
      }
    }
    expect(outside).toBe(0);
    expect(exited).toBeGreaterThan(0);
  });
});
