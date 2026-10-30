import { z } from "zod";

/**
 * Shapes of regions/<id>/effluent.config.json (hand-edited inputs) and
 * regions/<id>/effluent-net.json (written by pipeline:effluent-net) for the effluent
 * screening model. Nothing here assumes a region id; the caller passes the parsed JSON.
 * Every number in the config carries a `source` string; an unsourced value is `null`.
 */

const num = z.number().finite();
const source = z.string().min(1);

/** A sourced scalar; `value` is null when unverified. */
const sourced = z.object({ value: num.nullable(), source });
export type Sourced = z.infer<typeof sourced>;

const range = z.object({
  low: num,
  central: num,
  high: num,
});

export const LEVELS = ["low", "central", "high"] as const;
export type Level = (typeof LEVELS)[number];

const lakeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  inReaches: z.array(z.number().int()),
  outReach: z.number().int(),
  areaKm2: sourced,
  volumeHm3: sourced,
  meanDepthM: sourced,
  tpLoadTPerYr: sourced,
  residenceYr: z.object({ low: num, high: num, source }),
});
export type LakeConfig = z.infer<typeof lakeSchema>;

const outfallConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  reach: z.number().int(),
  flowM3s: sourced,
  effluent: z.object({
    bodMgL: sourced,
    /** Not in every config; when absent the model needs the DO passed explicitly. */
    doMgL: sourced.optional(),
    coliformsPer100mL: sourced,
    tpMgL: sourced,
  }),
});
export type OutfallConfig = z.infer<typeof outfallConfigSchema>;

export const effluentConfigSchema = z.object({
  mouthReach: z.number().int(),
  gauges: z.array(z.object({ id: z.string().min(1), name: z.string().min(1) })),
  lake: lakeSchema,
  outfalls: z.array(outfallConfigSchema),
  thresholds: z.object({
    doMinMgL: sourced,
    coliformsPer100mL: sourced,
    bodMgL: sourced,
  }),
  coefficients: z.object({
    kdPerDay: range.extend({ theta: num, source }),
    coliformDecayPerDay: range.extend({ theta: num, source }),
    kaRule: z.object({ value: z.literal("covar"), theta: num, source }),
    manningN: range.extend({ source }),
    widthCoef: range.extend({ exponent: num, source }),
    minSlope: sourced,
    bodBottleRatePerDay: sourced,
    waterTempC: sourced,
    elevationM: sourced,
  }),
  background: z.object({
    bodMgL: sourced,
    coliformsPer100mL: sourced,
    doSaturationFrac: sourced,
  }),
});
export type EffluentConfig = z.infer<typeof effluentConfigSchema>;

export const NET_COLUMNS = [
  "id",
  "nextDown",
  "lengthKm",
  "dischargeM3s",
  "gradientMPerKm",
  "uplandKm2",
  "gauge",
] as const;

const netRowSchema = z.tuple([
  z.number().int(),
  z.number().int(),
  num,
  num,
  num,
  num,
  z.number().int().nonnegative(),
]);

export const effluentNetFileSchema = z.object({
  region: z.string().min(1),
  columns: z.tuple([
    z.literal(NET_COLUMNS[0]),
    z.literal(NET_COLUMNS[1]),
    z.literal(NET_COLUMNS[2]),
    z.literal(NET_COLUMNS[3]),
    z.literal(NET_COLUMNS[4]),
    z.literal(NET_COLUMNS[5]),
    z.literal(NET_COLUMNS[6]),
  ]),
  gauges: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        climatology: z.object({ meanM3s: num.positive() }),
      }),
    )
    .min(1),
  lake: lakeSchema,
  reaches: z.array(netRowSchema),
  outfalls: z.array(
    z.object({ id: z.string().min(1), reach: z.number().int() }),
  ),
});

/** One river reach of the subgraph. `gaugeId` is the gauge whose flow scales it. */
export interface NetReach {
  id: number;
  /** 0 = river mouth (leaves the subgraph). */
  nextDown: number;
  lengthKm: number;
  /** HydroRIVERS DIS_AV_CMS, 1971–2000 natural mean. */
  dischargeM3s: number;
  gradientMPerKm: number;
  uplandKm2: number;
  gaugeId: string;
}

export interface EffluentNet {
  region: string;
  gauges: { id: string; name: string; climatologyMeanM3s: number }[];
  lake: LakeConfig;
  reaches: NetReach[];
  outfalls: { id: string; reach: number }[];
}

export function parseEffluentConfig(raw: unknown): EffluentConfig {
  return effluentConfigSchema.parse(raw);
}

/** Parse effluent-net.json: rows become objects, the gauge index becomes the gauge id, ids must be unique and resolve. */
export function parseEffluentNet(raw: unknown): EffluentNet {
  const file = effluentNetFileSchema.parse(raw);
  const gauges = file.gauges.map((g) => ({
    id: g.id,
    name: g.name,
    climatologyMeanM3s: g.climatology.meanM3s,
  }));
  const seen = new Set<number>();
  const reaches = file.reaches.map((row): NetReach => {
    const [
      id,
      nextDown,
      lengthKm,
      dischargeM3s,
      gradientMPerKm,
      uplandKm2,
      gauge,
    ] = row;
    const g = gauges[gauge];
    if (!g)
      throw new Error(`reach ${id}: gauge index ${gauge} is out of range`);
    if (seen.has(id)) throw new Error(`duplicate reach id ${id}`);
    seen.add(id);
    return {
      id,
      nextDown,
      lengthKm,
      dischargeM3s,
      gradientMPerKm,
      uplandKm2,
      gaugeId: g.id,
    };
  });
  for (const r of reaches)
    if (r.nextDown !== 0 && !seen.has(r.nextDown))
      throw new Error(
        `reach ${r.id}: nextDown ${r.nextDown} is not in the net`,
      );
  return {
    region: file.region,
    gauges,
    lake: file.lake,
    reaches,
    outfalls: file.outfalls,
  };
}
