/**
 * npm run inspect:file -- <path> [--layer=<name>] [--samples=<n>]
 *
 * Profile one dataset without dumping it: columns and types, row count, per-column
 * stats from DuckDB SUMMARIZE (nulls %, min/max, approx distinct, mean), geometry
 * types and extent, and a few sample rows without geometry (long values truncated).
 *
 * Reads Parquet/GeoParquet, CSV, NDJSON/JSON, and anything GDAL opens via ST_Read
 * (GeoJSON, Shapefile, FileGDB with --layer). Writes the full profile to
 * data/work/inspect/adhoc/<name>.json and prints a compact summary. Read-only on
 * its input. Used by the inspect-dataset skill and the data-inspector agent.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { lit, openDb, type Row } from "../lib/duckdb";
import { requireInput } from "../lib/inputs";
import { rel, workPath } from "../lib/paths";

const MAX_TEXT = 80;

export function sourceSql(file: string, layer?: string): string {
  const f = lit(file);
  const ext = path.extname(file).toLowerCase();
  if (ext === ".parquet") return `read_parquet(${f})`;
  if (ext === ".csv") return `read_csv_auto(${f})`;
  if (ext === ".ndjson" || ext === ".jsonl") return `read_json_auto(${f})`;
  if (ext === ".json" && !file.endsWith(".geojson"))
    return `read_json_auto(${f})`;
  return layer ? `ST_Read(${f}, layer := ${lit(layer)})` : `ST_Read(${f})`;
}

const truncate = (v: unknown) =>
  typeof v === "string" && v.length > MAX_TEXT
    ? `${v.slice(0, MAX_TEXT)}… (${v.length} chars)`
    : v;

export async function inspectFile(
  file: string,
  opts: { layer?: string; samples?: number } = {},
) {
  const src = sourceSql(file, opts.layer);
  const db = await openDb();
  try {
    const columns = (await db.all(`DESCRIBE SELECT * FROM ${src}`)).map(
      (c) => ({ name: String(c.column_name), type: String(c.column_type) }),
    );
    const geomCols = columns
      .filter((c) => c.type.startsWith("GEOMETRY"))
      .map((c) => c.name);
    const q = (n: string) => `"${n.replaceAll('"', '""')}"`;
    const exclude = geomCols.length
      ? ` EXCLUDE (${geomCols.map(q).join(", ")})`
      : "";
    const [{ n } = { n: 0 }] = await db.all(
      `SELECT count(*)::BIGINT AS n FROM ${src}`,
    );

    const stats =
      columns.length > geomCols.length
        ? (await db.all(`SUMMARIZE SELECT *${exclude} FROM ${src}`)).map(
            (s: Row) => ({
              column: s.column_name,
              type: s.column_type,
              nullPct: s.null_percentage,
              approxDistinct: s.approx_unique,
              min: truncate(s.min),
              max: truncate(s.max),
              mean: s.avg,
            }),
          )
        : [];

    // One query per aggregate: combining these three in a single SELECT segfaults
    // DuckDB spatial on reaches.geojson (checked 2026-09-30); separately they work.
    const geometry = [];
    for (const g of geomCols) {
      const one = async (expr: string) =>
        (await db.all(`SELECT ${expr} AS v FROM ${src}`))[0]?.v;
      geometry.push({
        column: g,
        types: await one(
          `list_distinct(list(ST_GeometryType(${q(g)})::VARCHAR))`,
        ),
        extent: await one(`ST_Extent_Agg(${q(g)})::VARCHAR`),
        invalid: await one(`sum(ST_IsValid(${q(g)})::INT = 0)::INT`),
      });
    }

    const samples = (
      await db.all(`SELECT *${exclude} FROM ${src} LIMIT ${opts.samples ?? 3}`)
    ).map((r) =>
      Object.fromEntries(Object.entries(r).map(([k, v]) => [k, truncate(v)])),
    );

    return {
      file: rel(path.resolve(file)),
      layer: opts.layer ?? null,
      rows: Number(n),
      columns,
      geometry,
      stats,
      samples,
    };
  } finally {
    db.close();
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { layer: { type: "string" }, samples: { type: "string" } },
  });
  const file = positionals[0];
  if (!file)
    throw new Error("usage: npm run inspect:file -- <path> [--layer=<name>]");
  const profile = await inspectFile(requireInput(path.resolve(file)), {
    layer: values.layer,
    samples: values.samples ? Number(values.samples) : undefined,
  });

  const name = `${path.basename(file)}${values.layer ? `__${values.layer}` : ""}`;
  const out = workPath("inspect/adhoc", `${name}.json`);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(profile, null, 2) + "\n");

  console.log(
    `${profile.file}: ${profile.rows} rows, ${profile.columns.length} columns` +
      (profile.geometry.length
        ? `, geometry ${profile.geometry.map((g) => `${g.column} ${JSON.stringify(g.types)} invalid=${g.invalid}`).join("; ")}`
        : ""),
  );
  console.log(
    `columns: ${profile.columns.map((c) => `${c.name}:${c.type}`).join(", ")}`,
  );
  console.log(`profile: ${rel(out)}`);
}

// Run only as a script, not when imported by tests.
if (process.argv[1] && import.meta.filename === path.resolve(process.argv[1])) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
