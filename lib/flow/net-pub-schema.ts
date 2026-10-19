import { z } from "zod";
import { flowNetNodeKindSchema } from "./net-schema";

/**
 * Shape of public/flow/<region>/<sectionId>.net.json, schema "flow-net-pub/1": the compact,
 * published form of a flow-net/1 (F3.2, pipeline:flow-net-publish; encode/decode in net-pub.ts).
 *
 * - `origin` = [lon0, lat0], the SW corner of `bbox` (6 decimals). Positions are integer local
 *   metres: x = (lon - lon0) * (PI/180) * R * cos(lat0), y = (lat - lat0) * (PI/180) * R,
 *   R = 6371008.8, rounded. Decoding is the inverse; the error is under 1 m (the net is built on
 *   a 10 m grid).
 * - Polylines (branch `xy`, reservoir rings) are flat integer arrays [x0, y0, dx1, dy1, ...],
 *   delta-encoded. Branch `hw` (half-width, integer metres) is [h0, dh1, ...] with one value per
 *   vertex of `xy`.
 * - `nodes` are parallel arrays; `kind` is the flow-net/1 node kind string, `reservoir` the index
 *   into `reservoirs` or -1. Branch from/to, reservoir inlets and outlets refer to node indices,
 *   in the order of the flow-net/1 file. Branch and node ids are not kept.
 * - `share` and `flux` are copied verbatim from flow-net/1 (illustrative display model, not a
 *   measured discharge partition); flux is null if the network had cycles.
 * - `source` is copied verbatim (attribution is required wherever the net is shown).
 * - Compact JSON, keys in the order below: two runs give the same bytes.
 */

const num = z.number().finite();
const int = z.number().int();

export const FLOW_NET_PUB_SCHEMA = "flow-net-pub/1";

export const flowNetPubSchema = z
  .strictObject({
    schema: z.literal(FLOW_NET_PUB_SCHEMA),
    id: z.string().min(1),
    region: z.string().min(1),
    origin: z.tuple([num, num]),
    bbox: z.tuple([num, num, num, num]),
    courseLengthM: int,
    source: z.strictObject({
      dates: z.tuple([z.string(), z.string()]),
      attribution: z.string(),
    }),
    model: z.strictObject({ shares: z.literal("illustrative") }),
    qa: z.strictObject({
      wetCourseCoverage: num.nullable(),
      cycles: num,
    }),
    nodes: z.strictObject({
      x: z.array(int),
      y: z.array(int),
      kind: z.array(flowNetNodeKindSchema),
      reservoir: z.array(int),
    }),
    branches: z.array(
      z.strictObject({
        from: int.nonnegative(),
        to: int.nonnegative(),
        kind: z.enum(["channel", "connector"]),
        share: num,
        flux: num.nullable(),
        xy: z.array(int),
        hw: z.array(int),
      }),
    ),
    reservoirs: z.array(
      z.strictObject({
        rings: z.array(z.array(int)),
        areaKm2: num,
        drift: z.tuple([num, num]),
        inlets: z.array(int.nonnegative()),
        outlets: z.array(z.tuple([int.nonnegative(), num, num.nullable()])),
      }),
    ),
  })
  .superRefine((net, ctx) => {
    const bad = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: "custom", path, message });
    const n = net.nodes.x.length;
    if (
      net.nodes.y.length !== n ||
      net.nodes.kind.length !== n ||
      net.nodes.reservoir.length !== n
    )
      bad(["nodes"], "parallel arrays must have equal length");
    const ref = (i: number) => i >= 0 && i < n;
    net.branches.forEach((b, i) => {
      if (!ref(b.from) || !ref(b.to)) bad(["branches", i], "unknown node");
      if (b.xy.length % 2 !== 0 || b.xy.length / 2 !== b.hw.length)
        bad(["branches", i], "xy must hold 2 values per hw value");
    });
    net.reservoirs.forEach((r, i) => {
      r.rings.forEach((ring, j) => {
        if (ring.length % 2 !== 0) bad(["reservoirs", i, "rings", j], "odd");
      });
      if (!r.inlets.every(ref) || !r.outlets.every((o) => ref(o[0])))
        bad(["reservoirs", i], "unknown node");
    });
  });
export type FlowNetPub = z.infer<typeof flowNetPubSchema>;
