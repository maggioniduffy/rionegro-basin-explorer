import { describe, expect, it } from "vitest";
import type { FlowNet } from "@/lib/flow/net-schema";
import { endsLinked } from "@/pipeline/lib/net-gate";

const opts = {
  endTolM: 150,
  minInsideWater: 0.95,
  maxConnectorShare: 0.1,
  minPathRatio: 0.5,
};

// 1 degree of latitude is about 111.2 km; nodes sit on a meridian so s is easy to set.
const LAT0 = -40;
const dLat = (m: number) => m / 111_195;

type Arm = {
  id: string;
  from: string;
  to: string;
  kind?: "channel" | "connector";
  half?: number;
  lenM: number;
};

function build(
  nodes: [string, number, "source" | "sink" | "split" | "join"][],
  arms: Arm[],
  inside: number | null = 0.99,
): FlowNet {
  const pos = new Map(nodes.map(([id, s]) => [id, s]));
  return {
    schema: "flow-net/1",
    id: "t",
    region: "nqn",
    bbox: [-70, -41, -69, -40],
    source: {
      imagery: "",
      scenes: [],
      dates: ["", ""],
      dem: "",
      attribution: "",
    },
    model: { shares: "illustrative", capacityExponent: 1 },
    courseLengthM: 10_000,
    nodes: nodes.map(([id, s, kind]) => ({
      id,
      lon: -70,
      lat: LAT0 + dLat(s),
      s,
      kind,
      reservoir: null,
    })),
    branches: arms.map((a) => {
      const s0 = pos.get(a.from)!;
      return {
        id: a.id,
        from: a.from,
        to: a.to,
        kind: a.kind ?? "channel",
        lon: [-70, -70],
        lat: [LAT0 + dLat(s0), LAT0 + dLat(s0 + a.lenM)],
        halfWidthM: [a.half ?? 50, a.half ?? 50],
        lengthM: a.lenM,
        meanWidthM: 100,
        capacity: 1,
        share: 1,
        flux: null,
        orient: "course",
        narrow: false,
        s: [s0, s0 + a.lenM],
      };
    }),
    reservoirs: [],
    qa: {
      courseCoverage: 1,
      wetCourseCoverage: 0.4,
      courseInWater: 0.5,
      insideWater: inside,
      f1InsideWater: null,
      cycles: 0,
      connectors: 0,
      parallelArms: 0,
      lakeIoU: null,
    },
  };
}

const nodes: [string, number, "source" | "sink" | "split" | "join"][] = [
  ["a", 0, "source"],
  ["b", 10_000, "sink"],
  ["m", 5_000, "split"],
];

describe("endsLinked", () => {
  it("passes a linked main arm and picks the wider of two parallel arms", () => {
    const n = build(nodes, [
      { id: "n1", from: "a", to: "b", half: 20, lenM: 10_000 },
      { id: "s1", from: "a", to: "m", half: 80, lenM: 5_000 },
      { id: "s2", from: "m", to: "b", half: 60, lenM: 5_000 },
    ]);
    const r = endsLinked(n, opts);
    expect(r.linked).toBe(true);
    expect(r.path?.minHalfWidthM).toBe(60);
    expect(r.path?.connectorShare).toBe(0);
  });

  it("fails when the path stops short of the downstream end", () => {
    const n = build(nodes, [{ id: "s1", from: "a", to: "m", lenM: 5_000 }]);
    expect(endsLinked(n, opts).linked).toBe(false);
  });

  it("fails when the path is mostly connectors", () => {
    const n = build(nodes, [
      { id: "c", from: "a", to: "b", kind: "connector", lenM: 10_000 },
    ]);
    const r = endsLinked(n, opts);
    expect(r.linked).toBe(false);
    expect(r.reason).toMatch(/connector/);
  });

  it("fails when insideWater is low or null", () => {
    const arms: Arm[] = [{ id: "n1", from: "a", to: "b", lenM: 10_000 }];
    expect(endsLinked(build(nodes, arms, 0.5), opts).linked).toBe(false);
    expect(endsLinked(build(nodes, arms, null), opts).linked).toBe(false);
  });
});
