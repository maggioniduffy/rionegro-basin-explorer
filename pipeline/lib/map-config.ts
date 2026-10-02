import { z } from "zod";
import raw from "../map.config.json";

const byStrahler = z.record(z.string(), z.number());

/** From `min` (inclusive) upwards, the layer appears at `minzoom`. */
const step = z.object({ min: z.number(), minzoom: z.number().int() });

const bbox = z.object({
  xmin: z.number(),
  ymin: z.number(),
  xmax: z.number(),
  ymax: z.number(),
});

const schema = z.object({
  basinBbox: bbox,
  bounds: bbox,
  minzoom: z.number().int(),
  maxzoom: z.number().int(),
  reachMinzoomByStrahler: byStrahler,
  ign: z.object({
    detailMinzoomByKm: z.array(step),
    extraLakeMinzoomByKm2: z.array(step),
    damsMinzoom: z.number().int(),
  }),
  localities: z.object({
    minzoomByPlace: z.object({
      city: z.number().int(),
      town: z.number().int(),
      village: z.number().int(),
    }),
  }),
  mask: z.object({
    strahlerFactor: byStrahler,
    baseHalfWidthKm: z.array(z.number().positive()).min(1),
  }),
});

export type MapConfig = z.infer<typeof schema>;

/** pipeline/map.config.json, validated. */
export const mapConfig: MapConfig = schema.parse(raw);

/** Zoom at which a reach of this Strahler order first appears. */
export function reachMinzoom(config: MapConfig, strahler: number): number {
  const z = config.reachMinzoomByStrahler[String(strahler)];
  if (z === undefined)
    throw new Error(`no minzoom for Strahler order ${strahler}`);
  return z;
}

/**
 * Zoom at which a feature of this size first appears: the first step, read top to bottom,
 * whose `min` is at most `value`. The last step must have min 0.
 */
export function stepMinzoom(
  steps: readonly { min: number; minzoom: number }[],
  value: number,
): number {
  const hit = steps.find((s) => value >= s.min);
  if (!hit) throw new Error(`no minzoom step for ${value}`);
  return hit.minzoom;
}
