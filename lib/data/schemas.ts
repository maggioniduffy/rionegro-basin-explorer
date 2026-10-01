import { z } from "zod";

/**
 * Document shapes of data/out/*.ndjson (written by pipeline:named and pipeline:export)
 * as stored in Mongo. Strict objects: a field the pipeline adds or renames fails the
 * seed until it is declared here, so the app never relies on an unchecked attribute.
 */

const num = z.number().finite();

/** [west, south, east, north] in degrees. */
const bboxSchema = z.tuple([num, num, num, num]);
export type Bbox = z.infer<typeof bboxSchema>;

export const riverSchema = z.strictObject({
  _id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  shortName: z.string().min(1),
  type: z.string().min(1),
  nameConfidence: z.enum(["strong", "weak"]),
  /** Slug of the river it flows into, or "sea". */
  flowsInto: z.string().min(1),
  mouthReach: z.number().int(),
  sourceReach: z.number().int(),
  reachCount: z.number().int().positive(),
  lengthKm: num,
  dropM: num,
  gradientMPerKm: num,
  mouth: z.strictObject({
    lat: num,
    lon: num,
    elevationM: num,
    dischargeM3s: num,
    uplandKm2: num,
    distanceToSeaKm: num,
    strahler: z.number().int(),
    regulationPct: num,
  }),
  source: z.strictObject({
    kind: z.enum(["headwater", "confluence"]),
    lat: num,
    lon: num,
    elevationM: num,
  }),
  watershed: z.strictObject({
    floodedMinPct: num,
    floodedMaxPct: num,
    lakesPct: num,
    population: z.number().int(),
  }),
  bbox: bboxSchema,
  nonPerennialPct: num,
  unknownPct: num,
  /** Dotted paths of modeled or estimated values (CLAUDE.md rule 4). */
  modeled: z.array(z.string()),
  provenance: z.record(z.string(), z.string()),
});
export type River = z.infer<typeof riverSchema>;

/** As stored in Mongo: the seed adds normalized names for search. */
export type RiverDoc = River & { searchTerms: string[] };

export const reachSchema = z.strictObject({
  /** HydroRIVERS HYRIV_ID. */
  _id: z.number().int().positive(),
  /** Named river slug, null for unnamed reaches. */
  river: z.string().nullable(),
  network: z.enum(["connected", "endorheic"]),
  nextDown: z.number().int(),
  mainRiv: z.number().int(),
  lengthKm: num,
  distanceToSeaKm: num,
  uplandKm2: num,
  strahler: z.number().int(),
  dischargeM3s: num,
  catchmentMinElevationM: num,
  gradientMPerKm: num,
  upstreamFloodedMinPct: num,
  upstreamFloodedMaxPct: num,
  upstreamLakesPct: num,
  upstreamPopulation: z.number().int(),
  regulationPct: num,
  /** GIRES v1.0; null where GIRES has no prediction. */
  nonPerennial1d: z.union([z.literal(0), z.literal(1)]).nullable(),
  nonPerennialProb1d: num.nullable(),
  nonPerennial30d: z.union([z.literal(0), z.literal(1)]).nullable(),
  nonPerennialProb30d: num.nullable(),
  bbox: bboxSchema,
});
export type Reach = z.infer<typeof reachSchema>;
