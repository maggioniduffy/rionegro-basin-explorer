import { describe, expect, it } from "vitest";
import { flowNetSchema } from "@/lib/flow/net-schema";

const net = () => ({
  schema: "flow-net/1",
  id: "limay-096",
  region: "nqn",
  bbox: [-68.7, -39.3, -68.6, -39.2],
  source: {
    imagery: "Sentinel-2 L2A (Earth Search v1)",
    scenes: ["S2A_20T_20240110_0_L2A"],
    dates: ["2024-01-10", "2024-03-02"],
    dem: "Copernicus DEM GLO-30",
    attribution: "Contains modified Copernicus Sentinel data 2024",
  },
  model: { shares: "illustrative", capacityExponent: 1.5 },
  courseLengthM: 4000,
  nodes: [
    { id: "n0", lon: -68.7, lat: -39.3, s: 0, kind: "source", reservoir: null },
    { id: "n1", lon: -68.6, lat: -39.2, s: 100, kind: "port", reservoir: "r0" },
  ],
  branches: [
    {
      id: "b0",
      from: "n0",
      to: "n1",
      kind: "channel",
      lon: [-68.7, -68.6],
      lat: [-39.3, -39.2],
      halfWidthM: [40, 45],
      lengthM: 100,
      meanWidthM: 85,
      capacity: 784,
      share: 1,
      flux: 1,
      orient: "course",
      narrow: false,
      s: [0, 100],
    },
  ],
  reservoirs: [
    {
      id: "r0",
      rings: [
        [
          [-68.65, -39.25],
          [-68.6, -39.25],
          [-68.6, -39.2],
          [-68.65, -39.25],
        ],
      ],
      areaKm2: 1.5,
      inlets: ["n1"],
      outlets: [],
      drift: [1, 0],
      driftFrom: "course",
      sRange: null,
    },
  ],
  qa: {
    courseCoverage: 1,
    courseInWater: 1,
    insideWater: 1,
    f1InsideWater: 1,
    cycles: 0,
    connectors: 0,
    parallelArms: 0,
    lakeIoU: null,
  },
});

describe("flowNetSchema", () => {
  it("parses a minimal valid network", () => {
    expect(flowNetSchema.safeParse(net()).success).toBe(true);
  });

  it("rejects a branch whose arrays differ in length", () => {
    const bad = net();
    bad.branches[0]!.halfWidthM = [40];
    expect(flowNetSchema.safeParse(bad).success).toBe(false);
  });
});
