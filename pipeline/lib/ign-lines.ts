/**
 * The IGN "Corriente de agua" line reader shared by pipeline:lines (R3.3) and
 * pipeline:river-lines (R5.2 gap fill). Moved out of lines.ts; behaviour identical.
 */
import { type Db, lit } from "./duckdb";
import { IGN_LINE_LAYERS, IGN_ST_READ_OPTIONS } from "./ign";
import { requireInput } from "./inputs";

export interface IgnLayer {
  cls: string;
  shp: string;
}

/** The line layers of the given IGN classes (config ign.classes); an unknown class throws. */
export function ignLayersOf(classes: readonly string[]): IgnLayer[] {
  return classes.map((cls) => {
    const l = IGN_LINE_LAYERS.find((x) => x.cls === cls);
    if (!l) throw new Error(`ign.classes: unknown IGN class "${cls}"`);
    return { cls: l.cls, shp: requireInput(l.shp) };
  });
}

/**
 * Creates `table (cls, gid, fna, geom)` with the IGN lines of `layers` that satisfy `where`
 * (SQL over the shapefile columns, e.g. `ST_Intersects(geom, ...)`), geometry 2D WGS84.
 */
export async function readIgnLines(
  db: Db,
  table: string,
  layers: readonly IgnLayer[],
  where: string,
): Promise<void> {
  await db.conn.run(
    `CREATE TABLE ${table} (cls VARCHAR, gid BIGINT, fna VARCHAR, geom GEOMETRY)`,
  );
  for (const l of layers)
    await db.conn.run(`
      INSERT INTO ${table}
      SELECT ${lit(l.cls)}, CAST(gid AS BIGINT), fna, ST_Force2D(geom)
      FROM ST_Read(${lit(l.shp)}, ${IGN_ST_READ_OPTIONS})
      WHERE ${where}`);
}
