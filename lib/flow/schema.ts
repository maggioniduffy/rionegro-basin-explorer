import { z } from "zod";
import { FLOW_SPEEDS } from "./config";

/**
 * Shapes of the files written by pipeline/steps/flow-sections.ts into public/flow/<region>/.
 * Stations are ordered source to mouth, about 20 m apart.
 */

const num = z.number().finite();
const nullableNum = num.nullable();

export const flowReasonSchema = z.enum([
  "noDischarge",
  "reservoir",
  "noChannel",
  "narrow",
]);
export type FlowReason = z.infer<typeof flowReasonSchema>;

const bboxSchema = z.tuple([num, num, num, num]);

export const flowSectionSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+-\d{3}$/),
  river: z.string().min(1),
  riverName: z.string().min(1),
  index: z.number().int().nonnegative(),
  count: z.number().int().positive(),
  prev: z.string().nullable(),
  next: z.string().nullable(),
  lengthM: num,
  /** [west, south, east, north] in degrees. */
  bbox: bboxSchema,
  stations: z.object({
    lon: z.array(num),
    lat: z.array(num),
    /** Metres from the centerline, signed, + = left bank looking downstream; null if unknown. */
    nMin: z.array(nullableNum),
    nMax: z.array(nullableNum),
    /** 0 polygon, 1 band, 2 none. */
    src: z.array(z.number().int().min(0).max(2)),
    /** 1 = course taken from the HydroRIVERS fill. */
    gap: z.array(z.number().int().min(0).max(1)),
  }),
  channel: z.object({
    source: z.enum(["ign-polygon", "estimated-band", "mixed", "none"]),
    polygonShare: num,
    widthM: z.object({ min: num, p50: num, max: num }),
  }),
  discharge: z
    .object({
      value: num,
      kind: z.enum(["modeled", "measured"]),
      source: z.string(),
      period: z.string().optional(),
      reachId: num.optional(),
      station: z.unknown().optional(),
      dates: z.unknown().optional(),
    })
    .nullable(),
  regulationPct: nullableNum,
  flowable: z.boolean(),
  reason: flowReasonSchema.nullable(),
});
export type FlowSection = z.infer<typeof flowSectionSchema>;

export const flowIndexSchema = z.object({
  region: z.string().min(1),
  rivers: z.array(
    z.object({
      slug: z.string().min(1),
      name: z.string().min(1),
      sections: z.array(
        z.object({
          id: z.string(),
          index: z.number().int().nonnegative(),
          bbox: bboxSchema,
          mid: z.tuple([num, num]),
          flowable: z.boolean(),
          reason: flowReasonSchema.nullable(),
        }),
      ),
    }),
  ),
});
export type FlowIndex = z.infer<typeof flowIndexSchema>;

export type FlowSpeed = (typeof FLOW_SPEEDS)[number];

export function isFlowSpeed(x: unknown): x is FlowSpeed {
  return (FLOW_SPEEDS as readonly unknown[]).includes(x);
}

const SECTION_ID = /^([a-z0-9-]+)-(\d{3})$/;

/** "limay-010" -> { river: "limay", index: 10 }; null if the id is not a section id. */
export function parseSectionId(
  id: string,
): { river: string; index: number } | null {
  const m = SECTION_ID.exec(id);
  return m ? { river: m[1]!, index: Number(m[2]!) } : null;
}
