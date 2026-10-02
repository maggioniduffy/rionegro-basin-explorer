/**
 * pipeline:tiles — PMTiles for the map, via tippecanoe.
 *
 *   public/tiles/rivers.pmtiles  layers `reaches` (per-feature minzoom by Strahler order,
 *                                map.config.json), `basin` (outline) and `lakes`
 *                                (HydroLAKES polygons from pipeline:lakes, for outlines)
 *   public/tiles/mask.pmtiles    layers `mask` (Visible Land levels) and `endorheic` (land
 *                                visible only because of endorheic drainage, per level),
 *                                both from pipeline:mask
 *   public/tiles/subbasins.pmtiles layers `subbasins` (own areas from pipeline:subbasins)
 *                                and `outlines` (each node's whole area, for the selected
 *                                border); --detect-shared-borders keeps neighbours gap-free
 *   public/tiles/ign.pmtiles     IGN layers from pipeline:ign-layers: `detail` (perennial
 *                                lines HydroRIVERS lacks), `lakes_extra` (water bodies
 *                                HydroLAKES lacks), `dams` (points), `dam_walls` (lines);
 *                                per-feature minzoom from map.config.json (ign)
 *   public/tiles/localities.pmtiles layer `localities` (OSM city, town, village points from
 *                                pipeline:localities; per-feature minzoom by class,
 *                                map.config.json localities)
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
import { mapConfig, reachMinzoom, stepMinzoom } from "../lib/map-config";
import { ROOT, rel, workPath } from "../lib/paths";
import { writeReport } from "../lib/report";

const TIPPECANOE = process.env.TIPPECANOE ?? "tippecanoe";
const DECODE = `${TIPPECANOE}-decode`;
const TILE_JOIN = TIPPECANOE.replace(/tippecanoe$/, "tile-join");

/**
 * The mask's polygons (river buffers with thousands of holes) dominate tile weight:
 * up to ~274k vertices in one z6 tile at full detail, which MapLibre must triangulate
 * on every tile load while zooming. Up to MASK_LOW_MAXZOOM the mask is written at
 * MASK_LOW_DETAIL (2^10 = 1024 units per tile, about 2 per screen pixel, so edges
 * look the same); higher zooms keep full detail. Every mask tile is capped at
 * MASK_MAX_TILE_BYTES: tippecanoe lowers a bigger tile's detail rather than drop
 * features, and fails if it still doesn't fit, so no level ever goes missing.
 */
const MASK_LOW_MAXZOOM = 7;
const MASK_LOW_DETAIL = 10;
const MASK_MAX_TILE_BYTES = 100_000;
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
function decodeDistinct(
  file: string,
  layer: string,
  zoom: number,
  prop: string,
): Promise<Set<string>> {
  return decodeMatches(file, layer, zoom, `"${prop}": ?(-?\\d+)`);
}

/** As decodeDistinct, for a string-valued property. */
function decodeDistinctString(
  file: string,
  layer: string,
  zoom: number,
  prop: string,
): Promise<Set<string>> {
  return decodeMatches(file, layer, zoom, `"${prop}": ?"([^"]*)"`);
}

async function decodeMatches(
  file: string,
  layer: string,
  zoom: number,
  regex: string,
): Promise<Set<string>> {
  const child = spawn(DECODE, [
    `--layer=${layer}`,
    `--minimum-zoom=${zoom}`,
    `--maximum-zoom=${zoom}`,
    file,
  ]);
  const seen = new Set<string>();
  const pattern = new RegExp(regex);
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
 * Web Mercator span of a line, in tile units at zoom 0: for a multi-part line, the
 * span of its longest-spanning part. A part whose span at zoom z (this × 2^z) is under
 * one unit quantizes to a point and tippecanoe drops it; a feature disappears only if
 * all its parts do. It would also be an eighth of a pixel long, so its absence is
 * invisible.
 */
function spanUnitsZ0(geometry: unknown): number {
  const g = geometry as { type: string; coordinates: unknown };
  const lines = (
    g.type === "LineString" ? [g.coordinates] : g.coordinates
  ) as number[][][];
  let best = 0;
  for (const line of lines) {
    let [xmin, ymin, xmax, ymax] = [Infinity, Infinity, -Infinity, -Infinity];
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
    best = Math.max(best, xmax - xmin, ymax - ymin);
  }
  return best;
}

const sizeKb = async (file: string) =>
  Math.round((await stat(file)).size / 1024);

async function main() {
  const reachesIn = requireInput(workPath("tiles/reaches.geojson"));
  const basinIn = requireInput(workPath("tiles/basin.geojson"));
  const maskIn = requireInput(workPath("tiles/mask.geojson"));
  const endoIn = requireInput(workPath("tiles/mask_endorheic.geojson"));
  // HydroLAKES polygons with IGN names (pipeline:ign-layers).
  const lakesIn = requireInput(workPath("tiles/ign_lakes.geojson"));
  const subbasinsIn = requireInput(workPath("tiles/subbasins.geojson"));
  const outlinesIn = requireInput(workPath("tiles/subbasin_outlines.geojson"));
  const reachesZ = workPath("tiles/reaches.minzoom.geojson");
  const riversOut = `${TILES_DIR}/rivers.pmtiles`;
  const maskOut = `${TILES_DIR}/mask.pmtiles`;
  const subbasinsOut = `${TILES_DIR}/subbasins.pmtiles`;
  const ignOut = `${TILES_DIR}/ign.pmtiles`;
  const localitiesIn = requireInput(workPath("tiles/localities.geojson"));
  const localitiesZ = workPath("tiles/localities.minzoom.geojson");
  const localitiesOut = `${TILES_DIR}/localities.pmtiles`;
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
    `--named-layer=lakes:${lakesIn}`,
  ]);
  // Mask: low zooms at lower detail, high zooms at full detail, joined into one file.
  // --detect-shared-borders keeps each level's edge with its endorheic overlay in step.
  const maskLow = workPath("tiles/mask.low.pmtiles");
  const maskHigh = workPath("tiles/mask.high.pmtiles");
  const maskCommon = [
    "--force",
    "--no-feature-limit",
    `--maximum-tile-bytes=${MASK_MAX_TILE_BYTES}`,
    "--detect-shared-borders",
    "--quiet",
    `--named-layer=mask:${maskIn}`,
    `--named-layer=endorheic:${endoIn}`,
  ];
  for (const f of [maskOut, maskLow, maskHigh]) await rm(f, { force: true });
  await run(TIPPECANOE, [
    ...maskCommon,
    `--output=${maskLow}`,
    "--minimum-zoom=0",
    `--maximum-zoom=${MASK_LOW_MAXZOOM}`,
    `--full-detail=${MASK_LOW_DETAIL}`,
    `--low-detail=${MASK_LOW_DETAIL}`,
  ]);
  await run(TIPPECANOE, [
    ...maskCommon,
    `--output=${maskHigh}`,
    `--minimum-zoom=${MASK_LOW_MAXZOOM + 1}`,
    `--maximum-zoom=${maxzoom}`,
  ]);
  await run(TILE_JOIN, [
    "--force",
    "--no-tile-size-limit",
    "--quiet",
    `--output=${maskOut}`,
    maskLow,
    maskHigh,
  ]);
  await rm(subbasinsOut, { force: true });
  await run(TIPPECANOE, [
    ...common,
    `--output=${subbasinsOut}`,
    "--detect-shared-borders",
    `--named-layer=subbasins:${subbasinsIn}`,
    `--named-layer=outlines:${outlinesIn}`,
  ]);
  // IGN layers: every feature gets a minzoom (map.config.json, ign) as tippecanoe's
  // `tippecanoe` member, like the reaches.
  const ignCfg = mapConfig.ign;
  const ignLayers = [
    {
      layer: "detail",
      file: "ign_detail",
      minzoom: (f: Feature) =>
        stepMinzoom(ignCfg.detailMinzoomByKm, Number(f.properties.km)),
    },
    {
      layer: "lakes_extra",
      file: "ign_lakes_extra",
      minzoom: (f: Feature) =>
        stepMinzoom(ignCfg.extraLakeMinzoomByKm2, Number(f.properties.areaKm2)),
    },
    { layer: "dams", file: "ign_dams", minzoom: () => ignCfg.damsMinzoom },
    {
      layer: "dam_walls",
      file: "ign_dam_walls",
      minzoom: () => ignCfg.damsMinzoom,
    },
  ];
  const ignArgs: string[] = [];
  const ignExpected = new Map<string, { ids: Set<string>; minzoom: number }>();
  for (const l of ignLayers) {
    const input = requireInput(workPath(`tiles/${l.file}.geojson`));
    const collection = JSON.parse(await readFile(input, "utf8")) as {
      features: Feature[];
    };
    const ids = new Set<string>();
    const out = collection.features.map((f): Feature => {
      ids.add(String(f.properties.id));
      return { ...f, tippecanoe: { minzoom: l.minzoom(f) } };
    });
    const withZoom = workPath(`tiles/${l.file}.minzoom.geojson`);
    await writeFile(
      withZoom,
      JSON.stringify({ type: "FeatureCollection", features: out }),
    );
    ignExpected.set(l.layer, {
      ids,
      minzoom: Math.min(...out.map((f) => f.tippecanoe?.minzoom ?? 0)),
    });
    ignArgs.push(`--named-layer=${l.layer}:${withZoom}`);
  }
  await rm(ignOut, { force: true });
  await run(TIPPECANOE, [...common, `--output=${ignOut}`, ...ignArgs]);

  // Localities: a minzoom per class, like the reaches.
  const localityZoom = mapConfig.localities.minzoomByPlace;
  const localities = (
    JSON.parse(await readFile(localitiesIn, "utf8")) as { features: Feature[] }
  ).features.map((f): Feature => {
    const place = String(f.properties.place) as keyof typeof localityZoom;
    const minzoom = localityZoom[place];
    if (minzoom === undefined) throw new Error(`unknown place ${place}`);
    return { ...f, tippecanoe: { minzoom } };
  });
  await writeFile(
    localitiesZ,
    JSON.stringify({ type: "FeatureCollection", features: localities }),
  );
  await rm(localitiesOut, { force: true });
  await run(TIPPECANOE, [
    ...common,
    `--output=${localitiesOut}`,
    "--drop-rate=1",
    `--named-layer=localities:${localitiesZ}`,
  ]);
  const localityIds = new Set(localities.map((f) => String(f.properties.id)));
  const localitiesAtMax = await decodeDistinctString(
    localitiesOut,
    "localities",
    maxzoom,
    "id",
  );
  const localitiesFirstZoom = Math.min(
    ...localities.map((f) => f.tippecanoe?.minzoom ?? 0),
  );
  const localitiesBefore =
    localitiesFirstZoom > 0
      ? await decodeDistinctString(
          localitiesOut,
          "localities",
          localitiesFirstZoom - 1,
          "id",
        )
      : new Set<string>();
  const ignByLayer = [];
  for (const [layer, { ids, minzoom }] of ignExpected) {
    const atMax = await decodeDistinct(ignOut, layer, maxzoom, "id");
    const before =
      minzoom > 0
        ? await decodeDistinct(ignOut, layer, minzoom - 1, "id")
        : new Set<string>();
    ignByLayer.push({
      layer,
      features: ids.size,
      foundAtMaxzoom: atMax.size,
      missingAtMaxzoom: [...ids].filter((id) => !atMax.has(id)).length,
      firstZoom: minzoom,
      presentBeforeFirstZoom: before.size,
    });
  }

  const subbasinIds = new Set(
    (
      JSON.parse(await readFile(subbasinsIn, "utf8")) as { features: Feature[] }
    ).features.map((f) => String(f.properties.id)),
  );

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
  // From the lowest zoom the map allows: below it tippecanoe may drop sub-pixel
  // strips, which nobody can see.
  const { minzoom } = mapConfig;
  for (const z of [minzoom, Math.round((minzoom + maxzoom) / 2), maxzoom]) {
    const got = await decodeDistinct(maskOut, "mask", z, "level");
    const endo = await decodeDistinct(maskOut, "endorheic", z, "level");
    const subbasins = await decodeDistinctString(
      subbasinsOut,
      "subbasins",
      z,
      "id",
    );
    const outlines = await decodeDistinctString(
      subbasinsOut,
      "outlines",
      z,
      "id",
    );
    maskLevelsByZoom.push({
      zoom: z,
      levels: [...got].map(Number).sort(),
      endorheicLevels: [...endo].map(Number).sort(),
      subbasins: [...subbasins].sort(),
      outlines: [...outlines].sort(),
    });
  }

  const checks = {
    localitiesAllAtMaxzoom:
      localityIds.size > 0 &&
      [...localityIds].every((id) => localitiesAtMax.has(id)),
    localitiesNothingBeforeFirstZoom: localitiesBefore.size === 0,
    ignAllFeaturesAtMaxzoom: ignByLayer.every((l) => l.missingAtMaxzoom === 0),
    ignNothingBeforeItsMinzoom: ignByLayer.every(
      (l) => l.presentBeforeFirstZoom === 0,
    ),
    // Reaches shorter than one tile unit may be dropped (see spanUnitsZ0).
    everyReachFromItsMinzoom: reachesByZoom.every(
      (r) => r.missingVisible === 0,
    ),
    noReachBeforeItsMinzoom: reachesByZoom.every((r) => r.early === 0),
    // At maxzoom too, only sub-tile-unit reaches may be absent.
    allReachesAtMaxzoom:
      reachesByZoom.at(-1)?.expected === features.length &&
      reachesByZoom.at(-1)?.missingVisible === 0,
    everyMaskLevelAtEveryCheckedZoom: maskLevelsByZoom.every(
      (m) => m.levels.length === levelCount,
    ),
    // The overlay exists for every level (each level has some endorheic-only land).
    everyEndorheicLevelAtEveryCheckedZoom: maskLevelsByZoom.every(
      (m) => m.endorheicLevels.length === levelCount,
    ),
    everySubbasinAtEveryCheckedZoom: maskLevelsByZoom.every(
      (m) =>
        m.subbasins.length === subbasinIds.size &&
        m.subbasins.every((id) => subbasinIds.has(id)),
    ),
    everySubbasinOutlineAtEveryCheckedZoom: maskLevelsByZoom.every(
      (m) =>
        m.outlines.length === subbasinIds.size &&
        m.outlines.every((id) => subbasinIds.has(id)),
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
    ignByLayer,
    localities: {
      features: localityIds.size,
      foundAtMaxzoom: localitiesAtMax.size,
      firstZoom: localitiesFirstZoom,
      minzoomByPlace: localityZoom,
    },
    sizesKb: {
      [rel(riversOut)]: await sizeKb(riversOut),
      [rel(maskOut)]: await sizeKb(maskOut),
      [rel(subbasinsOut)]: await sizeKb(subbasinsOut),
      [rel(ignOut)]: await sizeKb(ignOut),
      [rel(localitiesOut)]: await sizeKb(localitiesOut),
    },
    outputs: [
      rel(riversOut),
      rel(maskOut),
      rel(subbasinsOut),
      rel(ignOut),
      rel(localitiesOut),
    ],
  });
  if (!Object.values(checks).every(Boolean))
    throw new Error(`tiles checks failed: ${JSON.stringify(checks)}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
