import { z } from "zod";

/**
 * Shape of data/work/<region>/flow-water/out/<sectionId>.net.json, schema "flow-net/1".
 * Written by pipeline:flow-water (F2, pipeline/py/flowwater/contract.py); read by the F3 particle engine.
 * Branch arrays run downstream (from -> to). Shares and flux are an illustrative display model
 * (capacity = mean width ^ capacityExponent), not a measured discharge partition.
 */

const num = z.number().finite();
const nullableNum = num.nullable();
const lonLat = z.tuple([num, num]);

export const flowNetNodeKindSchema = z.enum([
  "source",
  "sink",
  "split",
  "join",
  "pass",
  "port",
]);
export const flowNetOrientSchema = z.enum(["course", "dem", "tangent"]);
export const flowNetDriftFromSchema = z.enum(["ports", "course"]);

const nodeSchema = z.strictObject({
  id: z.string().min(1),
  lon: num,
  lat: num,
  /** Chainage along the IGN course, m. */
  s: num,
  kind: flowNetNodeKindSchema,
  reservoir: z.string().nullable(),
});

const branchSchema = z.strictObject({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  kind: z.enum(["channel", "connector"]),
  lon: z.array(num),
  lat: z.array(num),
  halfWidthM: z.array(num),
  lengthM: num,
  meanWidthM: num,
  capacity: num,
  share: num,
  /** Null when the network has cycles. */
  flux: nullableNum,
  orient: flowNetOrientSchema,
  narrow: z.boolean(),
  /** Course chainage of [from, to], m. */
  s: z.tuple([num, num]),
});

const reservoirSchema = z.strictObject({
  id: z.string().min(1),
  /** Outer ring first, then holes; closed, [lon, lat]. */
  rings: z.array(z.array(lonLat)),
  areaKm2: num,
  inlets: z.array(z.string()),
  outlets: z.array(
    z.strictObject({ node: z.string(), share: num, flux: nullableNum }),
  ),
  /** Unit vector [east, north]. */
  drift: lonLat,
  driftFrom: flowNetDriftFromSchema,
  sRange: z.tuple([num, num]).nullable(),
});

export const flowNetSchema = z
  .strictObject({
    schema: z.literal("flow-net/1"),
    id: z.string().min(1),
    region: z.string().min(1),
    /** [west, south, east, north] in degrees, of everything in the file. */
    bbox: z.tuple([num, num, num, num]),
    source: z.strictObject({
      imagery: z.string(),
      scenes: z.array(z.string()),
      dates: z.tuple([z.string(), z.string()]),
      dem: z.string(),
      attribution: z.string(),
    }),
    model: z.strictObject({
      shares: z.literal("illustrative"),
      capacityExponent: num,
    }),
    courseLengthM: num,
    nodes: z.array(nodeSchema),
    branches: z.array(branchSchema),
    reservoirs: z.array(reservoirSchema),
    qa: z.strictObject({
      courseCoverage: nullableNum,
      wetCourseCoverage: nullableNum,
      courseInWater: nullableNum,
      insideWater: nullableNum,
      f1InsideWater: nullableNum,
      cycles: num,
      connectors: num,
      parallelArms: num,
      lakeIoU: nullableNum,
    }),
  })
  .superRefine((net, ctx) => {
    const nodes = new Set(net.nodes.map((n) => n.id));
    const bad = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: "custom", path, message });
    net.branches.forEach((b, i) => {
      if (
        b.lon.length < 2 ||
        b.lon.length !== b.lat.length ||
        b.lon.length !== b.halfWidthM.length
      )
        bad(
          ["branches", i],
          "lon, lat and halfWidthM must have equal length >= 2",
        );
      if (!nodes.has(b.from)) bad(["branches", i, "from"], "unknown node");
      if (!nodes.has(b.to)) bad(["branches", i, "to"], "unknown node");
    });
    net.reservoirs.forEach((r, i) => {
      r.inlets.forEach((n, j) => {
        if (!nodes.has(n)) bad(["reservoirs", i, "inlets", j], "unknown node");
      });
      r.outlets.forEach((o, j) => {
        if (!nodes.has(o.node))
          bad(["reservoirs", i, "outlets", j, "node"], "unknown node");
      });
    });
  });
export type FlowNet = z.infer<typeof flowNetSchema>;
