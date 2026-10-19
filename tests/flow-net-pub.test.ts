import { describe, expect, it } from "vitest";
import { decodeNet, encodeNet, maxDecodeErrorM } from "@/lib/flow/net-pub";
import { flowNetPubSchema } from "@/lib/flow/net-pub-schema";
import type { FlowNet } from "@/lib/flow/net-schema";

const node = (
  id: string,
  lon: number,
  lat: number,
  kind: FlowNet["nodes"][number]["kind"],
  reservoir: string | null = null,
): FlowNet["nodes"][number] => ({ id, lon, lat, s: 0, kind, reservoir });
const branch = (
  id: string,
  from: string,
  to: string,
  lon: number[],
  lat: number[],
  share: number,
): FlowNet["branches"][number] => ({
  id,
  from,
  to,
  kind: "channel",
  lon,
  lat,
  halfWidthM: lon.map(() => 41.6),
  lengthM: 100,
  meanWidthM: 80,
  capacity: 1,
  share,
  flux: share,
  orient: "course",
  narrow: false,
  s: [0, 100],
});

const net: FlowNet = {
  schema: "flow-net/1",
  id: "limay-001",
  region: "nqn",
  bbox: [-68.2, -38.99, -68.1, -38.95],
  source: {
    imagery: "x",
    scenes: [],
    dates: ["2024-01-01", "2024-02-01"],
    dem: "x",
    attribution: "attr",
  },
  model: { shares: "illustrative", capacityExponent: 1 },
  courseLengthM: 4000.4,
  nodes: [
    node("a", -68.2, -38.99, "source"),
    node("b", -68.17, -38.97, "split"),
    node("c", -68.12, -38.96, "port", "r1"),
    node("d", -68.1, -38.95, "sink"),
  ],
  branches: [
    branch(
      "1",
      "a",
      "b",
      [-68.2, -68.185, -68.17],
      [-38.99, -38.98, -38.97],
      1,
    ),
    branch("2", "b", "c", [-68.17, -68.12], [-38.97, -38.96], 0.6),
    branch("3", "b", "d", [-68.17, -68.1], [-38.97, -38.95], 0.4),
  ],
  reservoirs: [
    {
      id: "r1",
      rings: [
        [
          [-68.13, -38.965],
          [-68.11, -38.965],
          [-68.11, -38.955],
          [-68.13, -38.965],
        ],
      ],
      areaKm2: 1.5,
      inlets: ["b"],
      outlets: [{ node: "c", share: 1, flux: null }],
      drift: [1, 0],
      driftFrom: "ports",
      sRange: [0, 10],
    },
  ],
  qa: {
    courseCoverage: 1,
    wetCourseCoverage: 1,
    courseInWater: 1,
    insideWater: null,
    f1InsideWater: null,
    cycles: 0,
    connectors: 0,
    parallelArms: 0,
    lakeIoU: null,
  },
};

describe("flow-net-pub/1", () => {
  it("round-trips within 1 m and keeps references", () => {
    const pub = flowNetPubSchema.parse(encodeNet(net));
    const dec = decodeNet(pub);
    expect(maxDecodeErrorM(net, dec)).toBeLessThan(1);
    expect(dec.branches.map((b) => [b.from, b.to])).toEqual([
      [0, 1],
      [1, 2],
      [1, 3],
    ]);
    expect(dec.nodes.reservoir).toEqual([-1, -1, 0, -1]);
    expect(dec.reservoirs[0]!.inlets).toEqual([1]);
    expect(dec.reservoirs[0]!.outlets).toEqual([[2, 1, null]]);
    expect(dec.branches[0]!.halfWidthM).toEqual([42, 42, 42]);
    expect(dec.branches[1]!.share).toBe(0.6);
    expect(dec.reservoirs[0]!.rings[0]!.lon).toHaveLength(4);
  });
});
