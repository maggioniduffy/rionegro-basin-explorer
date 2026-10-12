/**
 * What the map draws as river lines (R3.7), chosen by an explicit `mapLines` key in
 * regions/<id>/ign.config.json, never by guessing from which files exist:
 *
 *   absent or "reaches"  the HydroRIVERS reaches (nqn), clipped out of lakes by pipeline:lakes
 *                        (data/work/<id>/lakes/reach_geom.parquet)
 *   "pieces"             the display line pieces of pipeline:lines (cba: APRHI inside the
 *                        province, IGN outside), clipped out of lakes by pipeline:lakes
 *                        (data/work/<id>/lakes/line_geom.parquet)
 *
 * No default region and no fallback: an unknown value throws.
 */
import { readFile } from "node:fs/promises";
import { regionFile, REGION_ID } from "./paths";

export type MapLines = "reaches" | "pieces";

export function resolveMapLines(
  value: unknown,
  region: string = "?",
): MapLines {
  if (value === undefined || value === "reaches") return "reaches";
  if (value === "pieces") return "pieces";
  throw new Error(
    `regions/${region}/ign.config.json: mapLines must be "reaches" or "pieces" (got ${JSON.stringify(value)})`,
  );
}

/** The current region's map lines, from its ign.config.json. */
export async function loadMapLines(): Promise<MapLines> {
  const cfg = JSON.parse(
    await readFile(regionFile("ign.config.json"), "utf8"),
  ) as { mapLines?: unknown };
  return resolveMapLines(cfg.mapLines, REGION_ID);
}
