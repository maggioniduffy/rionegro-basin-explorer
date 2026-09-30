/**
 * pipeline:inspect — dump the schema of every downloaded layer to data/work/inspect/.
 *
 * Later steps must only use attribute names that appear here (CLAUDE.md rule 2).
 * Per layer: columns and types, feature count, CRS, extent (skipped for very large
 * layers) and a few sample rows without geometry.
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { lit, openDb, type Db, type Row } from "../lib/duckdb";
import { rawPath, rel, workPath } from "../lib/paths";
import { writeReport } from "../lib/report";
import { SOURCES } from "../sources";

/** Full-scan extent only below this size; RiverATLAS is global (~8.5M reaches). */
const EXTENT_MAX_FEATURES = 2_000_000;
const SAMPLE_ROWS = 3;

interface LayerMeta {
  name: string;
  feature_count: string;
  geometry_fields: {
    name: string;
    crs?: { auth_name?: string; auth_code?: string };
  }[];
}

/** Shapefiles and FileGDB folders under a source directory. */
async function findDatasets(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, {
    recursive: true,
    withFileTypes: true,
  })) {
    const full = path.join(entry.parentPath, entry.name);
    if (entry.isFile() && entry.name.endsWith(".shp")) found.push(full);
    if (entry.isDirectory() && entry.name.endsWith(".gdb")) found.push(full);
  }
  return found.sort();
}

/**
 * Layers of a dataset. ST_Read_Meta treats its argument as a file glob and returns
 * nothing for a .gdb folder, so for FileGDB we ask each .gdbtable file instead and
 * drop the GDB_* system tables. ST_Read still opens the folder by layer name.
 */
async function listLayers(db: Db, dataset: string): Promise<LayerMeta[]> {
  const files = dataset.endsWith(".gdb")
    ? (await readdir(dataset))
        .filter((f) => f.endsWith(".gdbtable"))
        .map((f) => path.join(dataset, f))
    : [dataset];
  const layers: LayerMeta[] = [];
  for (const file of files) {
    const [meta] = await db.all(
      `SELECT layers FROM ST_Read_Meta(${lit(file)})`,
    );
    for (const layer of (meta?.layers ?? []) as unknown as LayerMeta[]) {
      if (!layer.name.startsWith("GDB_")) layers.push(layer);
    }
  }
  return layers;
}

async function inspectLayer(db: Db, dataset: string, meta: LayerMeta) {
  const src = `ST_Read(${lit(dataset)}, layer=${lit(meta.name)})`;
  const geom = meta.geometry_fields[0]?.name;
  const featureCount = Number(meta.feature_count);
  const columns = (await db.all(`DESCRIBE SELECT * FROM ${src}`)).map((c) => ({
    name: c.column_name,
    type: c.column_type,
  }));
  const exclude = geom ? ` EXCLUDE ("${geom}")` : "";
  const samples = await db.all(
    `SELECT *${exclude} FROM ${src} LIMIT ${SAMPLE_ROWS}`,
  );
  let extent: Row | null = null;
  if (geom && featureCount <= EXTENT_MAX_FEATURES) {
    [extent = null] = await db.all(
      `SELECT ST_XMin(e) AS xmin, ST_YMin(e) AS ymin, ST_XMax(e) AS xmax, ST_YMax(e) AS ymax
       FROM (SELECT ST_Extent_Agg("${geom}") AS e FROM ${src})`,
    );
  }
  const crs = meta.geometry_fields[0]?.crs;
  return {
    dataset: rel(dataset),
    layer: meta.name,
    featureCount,
    crs: crs?.auth_code ? `${crs.auth_name}:${crs.auth_code}` : null,
    geometryColumn: geom ?? null,
    extent,
    columns,
    samples,
  };
}

async function main() {
  const db = await openDb();
  const outDir = workPath("inspect");
  await mkdir(outDir, { recursive: true });
  const layers: Record<string, unknown>[] = [];

  try {
    for (const src of SOURCES) {
      const dir = rawPath(src.id);
      if (!existsSync(dir))
        throw new Error(`${rel(dir)} missing; run pipeline:download first`);
      for (const dataset of await findDatasets(dir)) {
        for (const layerMeta of await listLayers(db, dataset)) {
          console.log(
            `${src.id}: ${layerMeta.name} (${layerMeta.feature_count} features)`,
          );
          const info = await inspectLayer(db, dataset, layerMeta);
          await writeFile(
            path.join(outDir, `${src.id}__${layerMeta.name}.json`),
            JSON.stringify(info, null, 2) + "\n",
          );
          layers.push({
            source: src.id,
            layer: info.layer,
            dataset: info.dataset,
            featureCount: info.featureCount,
            crs: info.crs,
            extent: info.extent,
            columnCount: info.columns.length,
            columns: info.columns.map((c) => `${c.name}:${c.type}`),
          });
        }
      }
    }
  } finally {
    db.close();
  }

  await writeReport("inspect", { layerCount: layers.length, layers });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
