import { z } from "zod";
import { MOUTH_KINDS } from "./mouth";

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
  /** Former names that search still finds (regions/nqn/names.json). */
  aliases: z.array(z.string().min(1)),
  nameConfidence: z.enum(["strong", "weak"]),
  /**
   * Slug of the river it flows into, or, when it joins none, "sea" (nqn) or, for reference
   * regions (R3.7), "sea" | "sink" | "region-edge" (lib/data/mouth.ts).
   */
  flowsInto: z.string().min(1),
  /**
   * Where the whole downstream path from the mouth ends, even through other rivers
   * (reference regions only; absent for nqn). A "sink" has no distance to the sea.
   */
  mouthKind: z.enum(MOUTH_KINDS).optional(),
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
    /** Null (reference regions) when the flow ends in an endorheic sink or crosses a network-overrides link: no sourced distance to the sea. */
    distanceToSeaKm: num.nullable(),
    strahler: z.number().int(),
    regulationPct: num,
  }),
  source: z.strictObject({
    kind: z.enum(["headwater", "lake", "confluence"]),
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
  /**
   * Stream id (pipeline:ign-streams), null when the reach is in none. A reach on a named
   * river can also be in a stream.
   */
  stream: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .nullable(),
  network: z.enum(["connected", "endorheic"]),
  nextDown: z.number().int(),
  mainRiv: z.number().int(),
  lengthKm: num,
  /**
   * Null in reference regions when the reach's flow ends in an endorheic sink, or when its
   * path crosses a network-overrides link (no sourced distance; see mouthKind).
   */
  distanceToSeaKm: num.nullable(),
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
  /**
   * IGN name matched to the reach (pipeline:ign-match); null when none is shown.
   * confidence: coverage of the reach by the IGN lines of that name ("none" when no IGN
   * line carries it: an owner-named reach); `reviewed` is true when a hand decision
   * (regions/nqn/ign-overrides.json) applies.
   */
  ign: z
    .strictObject({
      name: z.string().min(1),
      confidence: z.enum(["high", "medium", "low", "none"]),
      reviewed: z.boolean(),
    })
    .nullable(),
  /**
   * Reference regions only (R3.7): id of the level-1 sub-basin (basin) the reach belongs to,
   * from its pipeline:rivers root. Absent for nqn.
   */
  root: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .optional(),
  /**
   * Reference regions only: true when a displayed line piece matched to the reach is under
   * review by the source agency (APRHI "en revisión"). Absent otherwise.
   */
  lineReview: z.boolean().optional(),
  /**
   * Reference regions only: where the reach's water ends (lib/data/mouth.ts). Tells a null
   * distanceToSeaKm of a sink from one that has no sourced value (a network-overrides link).
   */
  mouthKind: z.enum(MOUTH_KINDS).optional(),
});
export type Reach = z.infer<typeof reachSchema>;

const slug = z.string().regex(/^[a-z0-9-]+$/);

/**
 * data/out/subbasins.ndjson (pipeline:subbasins). The root (level 0) is the whole basin;
 * levels 1-3 nest inside it. Metrics cover the node's whole set (its children included).
 * A "river" node drains to its river's mouth; the "endorheic" node is the land that
 * drains to closed depressions, so it has no river, name or outlet. An "area" node is a
 * management area of a reference agency (Córdoba: APRHI basins, subcuencas and UGH,
 * R3.5): it always has a name, no river, and an outlet only when one reach takes most of
 * its stream km (null otherwise).
 */
export const subbasinSchema = z
  .strictObject({
  _id: slug,
  kind: z.enum(["river", "endorheic", "area"]),
  /** Proper noun of a river node; null for endorheic land (labelled per locale). */
  name: z.string().min(1).nullable(),
  level: z.number().int().nonnegative(),
  parentId: slug.nullable(),
  /** Ids from the root down to this node (inclusive), for the breadcrumb. */
  path: z.array(slug).min(1),
  childIds: z.array(slug),
  /** Slug of the river whose mouth closes the sub-basin. */
  river: slug.nullable(),
  areaKm2: num,
  endorheicAreaKm2: num,
  reachCount: z.number().int().positive(),
  lengthKm: num,
  endorheicLengthKm: num,
  nonPerennialPct: num,
  unknownPct: num,
  elevationMinM: num,
  elevationMaxM: num,
  population: z.number().int(),
  lakesPct: num,
  floodedMinPct: num,
  floodedMaxPct: num,
  outlet: z
    .strictObject({
      hyrivId: z.number().int(),
      lat: num,
      lon: num,
      dischargeM3s: num,
      regulationPct: num,
    })
    .nullable(),
  /** Named rivers whose mouth lies in the sub-basin, largest first. */
  rivers: z.array(slug),
  bbox: bboxSchema,
  modeled: z.array(z.string()),
  provenance: z.record(z.string(), z.string()),
})
  .refine((d) => d.kind !== "area" || (d.name !== null && d.river === null), {
    message: "an area has a name and no river",
    path: ["name"],
  });
export type Subbasin = z.infer<typeof subbasinSchema>;

/**
 * data/out/streams.ndjson (pipeline:export): an IGN stream, a connected group of reaches
 * that share a shown IGN name (pipeline:ign-streams). Streams of approved rivers are not
 * here (they are rivers). `mouth` and `watershed` are RiverATLAS / HydroRIVERS values of
 * the mouth reach, as for rivers.
 */
export const streamSchema = z.strictObject({
  /** `<slug of the name>-<mouth HYRIV_ID>`. */
  _id: slug,
  name: z.string().min(1),
  mouthReach: z.number().int().positive(),
  /** Named reaches plus the unnamed ones absorbed between them. */
  reachCount: z.number().int().positive(),
  lengthKm: num,
  /** Sub-basin that holds the mouth (deepest node); null when none was found. */
  subbasin: slug.nullable(),
  /** Slug of the first approved river downstream of the mouth, null when none. */
  receivingRiver: slug.nullable(),
  mouth: z.strictObject({
    elevationM: num,
    dischargeM3s: num,
    uplandKm2: num,
    /** Null (reference regions) when the flow ends in an endorheic sink or crosses a network-overrides link. */
    distanceToSeaKm: num.nullable(),
    strahler: z.number().int(),
    regulationPct: num,
  }),
  watershed: z.strictObject({
    floodedMinPct: num,
    floodedMaxPct: num,
    lakesPct: num,
    population: z.number().int(),
  }),
  bbox: bboxSchema,
  /** Reference regions only: where the water of the stream's mouth reach ends. */
  mouthKind: z.enum(MOUTH_KINDS).optional(),
  /**
   * Other names the stream is searched by (reference regions only, R3.7): the source's raw
   * spellings, names in parentheses and aliases from the other agency's lines, without the
   * stream's own name. Absent for nqn.
   */
  aliases: z.array(z.string().min(1)).optional(),
  /** Dotted paths of modeled or estimated values (CLAUDE.md rule 4). */
  modeled: z.array(z.string()),
  provenance: z.record(z.string(), z.string()),
});
export type Stream = z.infer<typeof streamSchema>;

/** As stored in Mongo: the seed adds normalized names for search. */
export type StreamDoc = Stream & { searchTerms: string[] };
