import { z } from "zod";
import raw from "../map.config.json";

const byStrahler = z.record(z.string(), z.number());

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
