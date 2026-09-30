import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../../pipeline/lib/duckdb";
import { areaAlbersKm2, areaSpheroidKm2 } from "../../pipeline/lib/geo";

// Guards the axis-order pitfall in ST_Area_Spheroid. Needs the DuckDB spatial
// extension, which DuckDB downloads on first use.
describe("area helpers", () => {
  let db: Db;
  beforeAll(async () => {
    db = await openDb();
  }, 60_000);
  afterAll(() => db.close());

  it("spheroid and Albers agree on a 1°×1° cell at 41°S", async () => {
    const cell =
      "ST_GeomFromText('POLYGON((-63 -41,-62 -41,-62 -40,-63 -40,-63 -41))')";
    const [row] = await db.all(
      `SELECT ${areaSpheroidKm2(cell)} AS s, ${areaAlbersKm2(cell)} AS a`,
    );
    const s = Number(row?.s);
    const a = Number(row?.a);
    // ~9,413 km²; the unflipped spheroid call gives ~5,744.
    expect(s).toBeGreaterThan(9_300);
    expect(s).toBeLessThan(9_500);
    expect(Math.abs(s - a) / s).toBeLessThan(0.001);
  });
});
