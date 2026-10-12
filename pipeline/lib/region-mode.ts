/**
 * Whether the current region's roots come from a reference agency (basin.config.json
 * "mode": "reference", pipeline:basin / pipeline:rivers) instead of one sea outlet. Such a
 * region has several roots (river outlets, endorheic sinks, exits from the region), edited
 * flow edges (`next_down_edit`) and a root per reach, which R3.7 exports for the app.
 * Explicit config key, never guessed from which files exist.
 */
import { readFile } from "node:fs/promises";
import { regionFile } from "./paths";

export async function isReferenceRegion(): Promise<boolean> {
  const cfg = JSON.parse(
    await readFile(regionFile("basin.config.json"), "utf8"),
  ) as { mode?: string };
  return cfg.mode === "reference";
}
