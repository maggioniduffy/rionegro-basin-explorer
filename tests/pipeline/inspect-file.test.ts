import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inspectFile, sourceSql } from "../../pipeline/tools/inspect-file";

describe("inspect-file", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "inspect-file-"));
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it("picks a reader by extension", () => {
    expect(sourceSql("a.parquet")).toMatch(/^read_parquet/);
    expect(sourceSql("a.ndjson")).toMatch(/^read_json_auto/);
    expect(sourceSql("a.geojson")).toMatch(/^ST_Read/);
    expect(sourceSql("a.gdb", "L")).toContain("layer := 'L'");
  });

  it("profiles a GeoJSON without returning geometry in samples", async () => {
    const file = path.join(dir, "lines.geojson");
    const line = (id: number, name: string | null) => ({
      type: "Feature",
      properties: { id, name },
      geometry: {
        type: "LineString",
        coordinates: [
          [-70, -40],
          [-69, -39 - id],
        ],
      },
    });
    await writeFile(
      file,
      JSON.stringify({
        type: "FeatureCollection",
        features: [line(1, "Limay"), line(2, null)],
      }),
    );
    const p = await inspectFile(file);
    expect(p.rows).toBe(2);
    expect(p.geometry).toHaveLength(1);
    expect(p.geometry[0]?.invalid).toBe(0);
    const nameStats = p.stats.find((s) => s.column === "name");
    expect(Number(nameStats?.nullPct)).toBe(50);
    for (const row of p.samples) expect(Object.keys(row)).not.toContain("geom");
  }, 60_000);
});
