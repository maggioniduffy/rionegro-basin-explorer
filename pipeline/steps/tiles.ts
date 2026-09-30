/**
 * pipeline:tiles — PMTiles for the map, via tippecanoe.
 *
 *   public/tiles/rivers.pmtiles  layers `reaches` (per-feature minzoom by Strahler order,
 *                                map.config.json) and `basin` (outline)
 *   public/tiles/mask.pmtiles    layer `mask` (Visible Land levels, from pipeline:mask)
 *
 * The files are committed: Vercel serves them from /public and tippecanoe does not run
 * there. Feature and tile-size limits are off, so no reach is dropped; the report
 * decodes the tiles back and checks that every reach is present from its minzoom up.
 *
 * tippecanoe comes from PATH, or from $TIPPECANOE.
 */
import { spawn } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { requireInput } from "../lib/inputs";
import { mapConfig, reachMinzoom } from "../lib/map-config";
import { ROOT, rel, workPath } from "../lib/paths";
import { writeReport } from "../lib/report";

const TIPPECANOE = process.env.TIPPECANOE ?? "tippecanoe";
const DECODE = `${TIPPECANOE}-decode`;
const TILES_DIR = `${ROOT}/public/tiles`;

interface Feature {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: unknown;
  tippecanoe?: { minzoom: number };
}

/** Properties the map styles or filters on; everything else stays in Mongo. */
const REACH_PROPS = [
  "id",
  "river",
  "network",
  "strahler",
  "nonPerennial1d",
] as const;

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args);
    let out = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => (out += d.toString()));
    child.on("error", (err) =>
      reject(
        new Error(
          `${cmd}: ${err.message} (install tippecanoe, see pipeline/README.md)`,
        ),
      ),
    );
    child.on("close", (code) =>
      code === 0
        ? resolve(out)
        : reject(new Error(`${cmd} exited with ${code}:\n${out}`)),
    );
  });
}

/** Distinct values of `prop` among the features of one layer at one zoom. */
async function decodeDistinct(
  file: string,
  layer: string,
  zoom: number,
  prop: string,
): Promise<Set<string>> {
  const child = spawn(DECODE, [
    `--layer=${layer}`,
    `--minimum-zoom=${zoom}`,
    `--maximum-zoom=${zoom}`,
    file,
  ]);
  const seen = new Set<string>();
  const pattern = new RegExp(`"${prop}": ?(-?\\d+)`);
  const lines = createInterface({ input: child.stdout });
  for await (const line of lines) {
    const m = pattern.exec(line);
    if (m?.[1] !== undefined) seen.add(m[1]);
  }
  const code = await new Promise<number | null>((resolve) =>
    child.on("close", resolve),
  );
  if (code !== 0) throw new Error(`${DECODE} exited with ${code}`);
  return seen;
}

/** Tile extent tippecanoe writes by default (--full-detail=12). */
const TILE_EXTENT = 4096;

/**
 * Largest Web Mercator span of a line, in tile units at zoom 0. A line whose span at
 * zoom z (this × 2^z) is under one unit quantizes to a point, and tippecanoe drops it.
 * It would also be an eighth of a pixel long, so its absence is invisible.
 */
function spanUnitsZ0(geometry: unknown): number {
  const g = geometry as { type: string; coordinates: unknown };
  const lines = (
    g.type === "LineString" ? [g.coordinates] : g.coordinates
  ) as number[][][];
  let [xmin, ymin, xmax, ymax] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const line of lines) {
    for (const [lon = 0, lat = 0] of line) {
      const x = ((lon + 180) / 360) * TILE_EXTENT;
      const s = Math.sin((lat * Math.PI) / 180);
      const y =
        (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE_EXTENT;
      xmin = Math.min(xmin, x);
      xmax = Math.max(xmax, x);
      ymin = Math.min(ymin, y);
      ymax = Math.max(ymax, y);
    }
  }
  return Math.max(xmax - xmin, ymax - ymin);
}

const sizeKb = async (file: string) =>
  Math.round((await stat(file)).size / 1024);

async function main() {
  const reachesIn = requireInput(workPath("tiles/reaches.geojson"));
  const basinIn = requireInput(workPath("tiles/basin.geojson"));
  const maskIn = requireInput(workPath("tiles/mask.geojson"));
  const reachesZ = workPath("tiles/reaches.minzoom.geojson");
  const riversOut = `${TILES_DIR}/rivers.pmtiles`;
  const maskOut = `${TILES_DIR}/mask.pmtiles`;
  await mkdir(TILES_DIR, { recursive: true });
  const maxzoom = mapConfig.maxzoom;
  const version = (await run(TIPPECANOE, ["--version"])).trim();

  // 1. Reaches with a per-feature minzoom (tippecanoe's `tippecanoe` member).
  const fc = JSON.parse(await readFile(reachesIn, "utf8")) as {
    features: Feature[];
  };
  const minzoomById = new Map<string, number>();
  const spanById = new Map<string, number>();
  const features = fc.features.map((f): Feature => {
    const strahler = Number(f.properties.strahler);
    const minzoom = reachMinzoom(mapConfig, strahler);
    minzoomById.set(String(f.properties.id), minzoom);
    spanById.set(String(f.properties.id), spanUnitsZ0(f.geometry));
    return {
      type: "Feature",
      properties: Object.fromEntries(
        REACH_PROPS.map((k) => [k, f.properties[k] ?? null]),
      ),
      geometry: f.geometry,
      tippecanoe: { minzoom },
    };
  });
  await writeFile(
    reachesZ,
    JSON.stringify({ type: "FeatureCollection", features }),
  );

  // 2. tippecanoe. --force overwrites, so reruns are idempotent.
  const common = [
    "--force",
    "--minimum-zoom=0",
    `--maximum-zoom=${maxzoom}`,
    "--no-feature-limit",
    "--no-tile-size-limit",
    "--quiet",
  ];
  await rm(riversOut, { force: true });
  await run(TIPPECANOE, [
    ...common,
    `--output=${riversOut}`,
    "--use-attribute-for-id=id",
    `--named-layer=reaches:${reachesZ}`,
    `--named-layer=basin:${basinIn}`,
  ]);
  await rm(maskOut, { force: true });
  await run(TIPPECANOE, [
    ...common,
    `--output=${maskOut}`,
    `--named-layer=mask:${maskIn}`,
  ]);

  // 3. Decode back: reach ids per zoom vs the expected set; mask levels per zoom.
  const reachesByZoom = [];
  for (let z = 0; z <= maxzoom; z++) {
    const got = await decodeDistinct(riversOut, "reaches", z, "id");
    const expected = [...minzoomById].filter(([, mz]) => mz <= z);
    const missingIds = expected
      .filter(([id]) => !got.has(id))
      .map(([id]) => id);
    const subUnit = (id: string) => (spanById.get(id) ?? 0) * 2 ** z < 1;
    const missing = missingIds.length;
    const missingVisible = missingIds.filter((id) => !subUnit(id)).length;
    const early = [...got].filter(
      (id) => (minzoomById.get(id) ?? Infinity) > z,
    ).length;
    reachesByZoom.push({
      zoom: z,
      expected: expected.length,
      found: got.size,
      missing,
      missingVisible,
      early,
    });
    console.log(
      `z${z}: ${got.size}/${expected.length} reaches, missing ${missing} (${missingVisible} longer than a tile unit)`,
    );
  }
  const levelCount = mapConfig.mask.baseHalfWidthKm.length + 1;
  const maskLevelsByZoom = [];
  for (const z of [0, Math.floor(maxzoom / 2), maxzoom]) {
    const got = await decodeDistinct(maskOut, "mask", z, "level");
    maskLevelsByZoom.push({ zoom: z, levels: [...got].map(Number).sort() });
  }

  const checks = {
    // Reaches shorter than one tile unit may be dropped (see spanUnitsZ0).
    everyReachFromItsMinzoom: reachesByZoom.every(
      (r) => r.missingVisible === 0,
    ),
    noReachBeforeItsMinzoom: reachesByZoom.every((r) => r.early === 0),
    allReachesAtMaxzoom: reachesByZoom.at(-1)?.found === features.length,
    everyMaskLevelAtEveryCheckedZoom: maskLevelsByZoom.every(
      (m) => m.levels.length === levelCount,
    ),
  };
  await writeReport("tiles", {
    ok: Object.values(checks).every(Boolean),
    checks,
    tippecanoe: version,
    maxzoom,
    reachMinzoomByStrahler: mapConfig.reachMinzoomByStrahler,
    reaches: features.length,
    reachesByZoom,
    maskLevelsByZoom,
    sizesKb: {
      [rel(riversOut)]: await sizeKb(riversOut),
      [rel(maskOut)]: await sizeKb(maskOut),
    },
    outputs: [rel(riversOut), rel(maskOut)],
  });
  if (!Object.values(checks).every(Boolean))
    throw new Error(`tiles checks failed: ${JSON.stringify(checks)}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
