import { z } from "zod";
import { readFileSync } from "node:fs";
import { regionFile } from "./paths";

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
  /**
   * Display line pieces only (mapLines "pieces", cba): the order a piece no reach matched is
   * drawn at, by `<source>:<class>` of pipeline:lines, with "*" for every other class. It
   * picks the minzoom and width only; the piece has no Strahler order and none is shown.
   */
  pieceOrderByClass: z
    .record(z.string(), z.number().int().positive())
    .refine((r) => "*" in r, { message: 'pieceOrderByClass needs a "*" entry' })
    .optional(),
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

/** regions/<region>/map.config.json of the step's --region, validated. */
export const mapConfig: MapConfig = schema.parse(
  JSON.parse(readFileSync(regionFile("map.config.json"), "utf8")),
);

/** Zoom at which a reach of this Strahler order first appears. */
export function reachMinzoom(config: MapConfig, strahler: number): number {
  const z = config.reachMinzoomByStrahler[String(strahler)];
  if (z === undefined)
    throw new Error(`no minzoom for Strahler order ${strahler}`);
  return z;
}

/**
 * The order a display line piece is drawn at (tile property `rank`): the Strahler order of
 * its matched reach, else `pieceOrderByClass` by its source and class (see the schema).
 */
export function pieceOrder(
  config: Pick<MapConfig, "pieceOrderByClass">,
  props: { strahler?: unknown; src?: unknown; cls?: unknown },
): number {
  if (typeof props.strahler === "number") return props.strahler;
  const table = config.pieceOrderByClass;
  if (!table)
    throw new Error(
      'map.config.json: pieceOrderByClass is required with mapLines "pieces"',
    );
  const order =
    table[`${String(props.src)}:${String(props.cls)}`] ?? table["*"];
  if (order === undefined) throw new Error('pieceOrderByClass has no "*"');
  return order;
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
