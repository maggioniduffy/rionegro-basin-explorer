import path from "node:path";
import {
  DEFAULT_REGION,
  isRegionId,
  REGION_IDS,
  type RegionId,
} from "../../regions";

/** Repo root, resolved from this file so steps work from any cwd. */
export const ROOT = path.resolve(import.meta.dirname, "../..");

/**
 * The region a step works on: `--region <id>` or `--region=<id>`, else the default (`nqn`).
 * Region configs (basin, map, sub-basins, names, lakes, IGN thresholds and overrides) live in
 * regions/<id>/; work and output files in data/work/<id>/ and data/out/<id>/. data/raw is
 * shared: the HydroSHEDS, IGN and OSM downloads cover every region.
 */
export function parseRegionArg(argv: readonly string[]): RegionId {
  const i = argv.findIndex(
    (a) => a === "--region" || a.startsWith("--region="),
  );
  if (i === -1) return DEFAULT_REGION;
  const arg = argv[i] ?? "";
  const value = arg.includes("=")
    ? arg.slice(arg.indexOf("=") + 1)
    : argv[i + 1];
  if (!isRegionId(value))
    throw new Error(
      `--region must be one of ${REGION_IDS.join(", ")} (got ${value ?? "nothing"})`,
    );
  return value;
}

export const REGION_ID = parseRegionArg(process.argv);
export const REGION_DIR = path.join(ROOT, "regions", REGION_ID);
export const regionFile = (name: string) => path.join(REGION_DIR, name);

export const RAW_DIR = path.join(ROOT, "data/raw");
export const WORK_DIR = path.join(ROOT, "data/work", REGION_ID);
export const OUT_DIR = path.join(ROOT, "data/out", REGION_ID);

/** Committed manifest of source checksums (see steps/download.ts). */
export const CHECKSUMS_FILE = path.join(ROOT, "pipeline/checksums.json");

export const rawPath = (...parts: string[]) => path.join(RAW_DIR, ...parts);
export const workPath = (...parts: string[]) => path.join(WORK_DIR, ...parts);

/** Path relative to the repo root, for reports and logs. */
export const rel = (p: string) => path.relative(ROOT, p);
