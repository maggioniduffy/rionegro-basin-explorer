import path from "node:path";
import { DEFAULT_REGION } from "../../regions";

/** Repo root, resolved from this file so steps work from any cwd. */
export const ROOT = path.resolve(import.meta.dirname, "../..");

export const RAW_DIR = path.join(ROOT, "data/raw");
export const WORK_DIR = path.join(ROOT, "data/work");
export const OUT_DIR = path.join(ROOT, "data/out");

/**
 * Region configs (basin, map, sub-basins, names, lakes, IGN thresholds and overrides) live in
 * regions/<id>/. The steps use the default region until their --region flag lands (PLAN.md, Phase R1).
 */
export const REGION_ID = DEFAULT_REGION;
export const REGION_DIR = path.join(ROOT, "regions", REGION_ID);
export const regionFile = (name: string) => path.join(REGION_DIR, name);

/** Committed manifest of source checksums (see steps/download.ts). */
export const CHECKSUMS_FILE = path.join(ROOT, "pipeline/checksums.json");

export const rawPath = (...parts: string[]) => path.join(RAW_DIR, ...parts);
export const workPath = (...parts: string[]) => path.join(WORK_DIR, ...parts);

/** Path relative to the repo root, for reports and logs. */
export const rel = (p: string) => path.relative(ROOT, p);
