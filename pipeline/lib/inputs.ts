import { existsSync } from "node:fs";
import { rawPath, rel } from "./paths";

/** Extracted source files, as laid out by pipeline:download (see data/work/inspect). */
export const INPUTS = {
  hydroRivers: rawPath(
    "hydrorivers/HydroRIVERS_v10_sa_shp/HydroRIVERS_v10_sa.shp",
  ),
  hydroBasins: (level: number) =>
    rawPath(
      `hydrobasins/hybas_sa_lev${String(level).padStart(2, "0")}_v1c.shp`,
    ),
  riverAtlas: rawPath("riveratlas/RiverATLAS_v10.gdb"),
};

export function requireInput(file: string): string {
  if (!existsSync(file))
    throw new Error(`${rel(file)} missing; run pipeline:download first`);
  return file;
}
