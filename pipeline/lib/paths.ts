import path from "node:path";

/** Repo root, resolved from this file so steps work from any cwd. */
export const ROOT = path.resolve(import.meta.dirname, "../..");

export const RAW_DIR = path.join(ROOT, "data/raw");
export const WORK_DIR = path.join(ROOT, "data/work");
export const OUT_DIR = path.join(ROOT, "data/out");

/** Committed manifest of source checksums (see steps/download.ts). */
export const CHECKSUMS_FILE = path.join(ROOT, "pipeline/checksums.json");

export const rawPath = (...parts: string[]) => path.join(RAW_DIR, ...parts);
export const workPath = (...parts: string[]) => path.join(WORK_DIR, ...parts);

/** Path relative to the repo root, for reports and logs. */
export const rel = (p: string) => path.relative(ROOT, p);
