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
  /**
   * Optional (cba): a province's boundary drawn as a soft line, from the polygon of `path`
   * (under data/raw, EPSG:4326) whose `nameField` equals `name`. pipeline:export writes it to
   * data/work/<id>/tiles/province.geojson, pipeline:tiles to the `province` layer of
   * rivers.pmtiles. Absent = no layer.
   */
  provinceOutline: z
    .object({ path: z.string(), nameField: z.string(), name: z.string() })
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
    /**
     * Optional: lines are simplified by this many metres (Albers) before buffering. Dense
     * source lines (cba's APRHI pieces, a vertex every ~40 m) otherwise make the buffers
     * outgrow the dev laptop's memory; 25 m is under a fifth of a pixel at z10. Absent = none.
     */
    simplifyM: z.number().positive().optional(),
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
 * pieceOrder as a SQL expression over the columns `strahler`, `src` and `cls` of
 * tiles/reaches.geojson (pipeline:mask builds its buffers per order).
 */
export function pieceOrderSql(
  config: Pick<MapConfig, "pieceOrderByClass">,
): string {
  const table = config.pieceOrderByClass;
  if (!table)
    throw new Error(
      'map.config.json: pieceOrderByClass is required with mapLines "pieces"',
    );
  const q = (v: string) => `'${v.replaceAll("'", "''")}'`;
  const cases = Object.entries(table)
    .filter(([k]) => k !== "*")
    .map(([k, v]) => `WHEN ${q(k)} THEN ${v}`)
    .join(" ");
  return `coalesce(strahler, CASE src || ':' || cls ${cases} ELSE ${table["*"]} END)`;
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
