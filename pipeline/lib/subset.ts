import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { lit, type Db } from "./duckdb";
import { rel } from "./paths";

/** Stable fingerprint of a reach selection, used to key cached subsets. */
export function idsHash(ids: readonly number[]): string {
  return createHash("sha256")
    .update([...ids].sort((a, b) => a - b).join(","))
    .digest("hex");
}

/**
 * Write the rows of a global layer whose HYRIV_ID is in `idsTable` to a Parquet file,
 * without geometry. Skipped when the file exists for the same ids, so the multi-GB
 * source only has to be scanned (and kept on disk) when the selection changes.
 */
export async function cachedSubset(
  db: Db,
  opts: {
    label: string;
    /** FileGDB folder; may have been deleted once the cache exists. */
    source: string;
    layer: string;
    geometryColumn: string;
    idsTable: string;
    hash: string;
    file: string;
  },
): Promise<{ cached: boolean }> {
  const hashFile = `${opts.file}.ids-sha256`;
  if (
    existsSync(opts.file) &&
    existsSync(hashFile) &&
    (await readFile(hashFile, "utf8")).trim() === opts.hash
  ) {
    console.log(`${opts.label} basin subset: cached`);
    return { cached: true };
  }
  if (!existsSync(opts.source)) {
    const marker = path.join(path.dirname(opts.source), ".source.json");
    throw new Error(
      `${rel(opts.source)} is needed because the reach selection changed, but it was ` +
        `deleted to save disk. Remove ${rel(marker)} and rerun pipeline:download.`,
    );
  }
  console.log(`scanning global ${opts.label} (takes a few minutes)...`);
  await db.conn.run(`
    COPY (
      SELECT s.* EXCLUDE ("${opts.geometryColumn}")
      FROM ST_Read(${lit(opts.source)}, layer=${lit(opts.layer)}) s
      WHERE s.HYRIV_ID IN (SELECT HYRIV_ID FROM ${opts.idsTable})
    ) TO ${lit(opts.file)} (FORMAT parquet)`);
  await writeFile(hashFile, opts.hash + "\n");
  return { cached: false };
}
