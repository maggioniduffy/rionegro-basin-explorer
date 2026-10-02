/**
 * pipeline:localities — cities, towns and villages inside the basin, from OpenStreetMap.
 *
 * One Overpass request downloads the named place nodes (place = city | town | village)
 * in the basin's bounding box; it is cached in data/work/localities/overpass.json, so
 * reruns send nothing. Locally, DuckDB keeps the ones inside the basin polygon
 * (data/work/basin/basin.geojson) and writes data/work/tiles/localities.geojson for
 * pipeline:tiles. Only nodes are read: a place mapped as an area has no node here and
 * is not on the map (counted in the report's note, not guessed).
 *
 * Properties: id (OSM node id), name, place. OSM's `population` tag is left out: it is
 * the mapper's figure with no stated year or source (CLAUDE.md rule 2, rule 4).
 *
 * OSM data is ODbL 1.0, © OpenStreetMap contributors (see SOURCES.md).
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import { lit, openDb } from "../lib/duckdb";
import { requireInput } from "../lib/inputs";
import { rel, workPath } from "../lib/paths";
import { writeReport } from "../lib/report";

// Same workaround as pipeline:osm-names: Node's default 250 ms per-address timeout is
// too short for overpass-api.de from some networks.
net.setDefaultAutoSelectFamilyAttemptTimeout(2000);

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const USER_AGENT =
  "rio-negro-basin-explorer-pipeline/0.1 (one-off place lookup, cached)";
const PLACES = ["city", "town", "village"] as const;
type Place = (typeof PLACES)[number];

interface Bbox {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
}

interface OsmNode {
  type: "node";
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
}

async function fetchOverpass(
  bbox: Bbox,
  cacheFile: string,
): Promise<OsmNode[]> {
  if (existsSync(cacheFile)) {
    console.log(`Overpass: cached ${rel(cacheFile)}`);
    return (
      JSON.parse(await readFile(cacheFile, "utf8")) as { elements: OsmNode[] }
    ).elements;
  }
  const b = `${bbox.ymin},${bbox.xmin},${bbox.ymax},${bbox.xmax}`;
  const query = `[out:json][timeout:300][bbox:${b}];
node["place"~"^(${PLACES.join("|")})$"]["name"];
out;`;
  // 429 and 504 ("server too busy") are load on the public instance: back off.
  const waitsMin = [1, 2, 4];
  for (let attempt = 0; ; attempt++) {
    console.log("Overpass: one bbox request...");
    const res = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ data: query }),
      signal: AbortSignal.timeout(6 * 60_000),
    });
    const text = await res.text();
    if (res.ok) {
      await writeFile(cacheFile, text);
      return (JSON.parse(text) as { elements: OsmNode[] }).elements;
    }
    const message = `Overpass HTTP ${res.status}: ${text
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .slice(0, 400)}`;
    const wait = waitsMin[attempt];
    if (wait === undefined || !(res.status === 429 || res.status === 504)) {
      throw new Error(message);
    }
    console.log(`  ${message.slice(0, 120)}... retrying in ${wait} min`);
    await new Promise((r) => setTimeout(r, wait * 60_000));
  }
}

async function main() {
  const basinFile = requireInput(workPath("basin/basin.geojson"));
  const basinReport = JSON.parse(
    await readFile(requireInput(workPath("basin/report.json")), "utf8"),
  ) as { polygon: { bbox: Bbox } };
  const outDir = workPath("localities");
  await mkdir(outDir, { recursive: true });
  const elements = await fetchOverpass(
    basinReport.polygon.bbox,
    `${outDir}/overpass.json`,
  );

  const nodes = elements.filter(
    (e) =>
      e.type === "node" &&
      e.tags?.name &&
      PLACES.includes(e.tags.place as Place),
  );
  const nodesFile = `${outDir}/nodes.ndjson`;
  await writeFile(
    nodesFile,
    nodes
      .map((n) =>
        JSON.stringify({
          id: String(n.id),
          name: n.tags?.name,
          place: n.tags?.place,
          lon: n.lon,
          lat: n.lat,
        }),
      )
      .join("\n") + "\n",
  );

  const db = await openDb();
  let inside;
  try {
    inside = await db.all(`
      WITH basin AS (SELECT geom FROM ST_Read(${lit(basinFile)}))
      SELECT n.id, n.name, n.place, n.lon, n.lat
      FROM read_json(${lit(nodesFile)}, format = 'newline_delimited',
        columns = {id: 'VARCHAR', name: 'VARCHAR', place: 'VARCHAR',
          lon: 'DOUBLE', lat: 'DOUBLE'}) n,
        basin
      WHERE ST_Within(ST_Point(n.lon, n.lat), basin.geom)
      ORDER BY n.place, n.name, n.id`);
  } finally {
    db.close();
  }

  const features = inside.map((r) => ({
    type: "Feature" as const,
    properties: {
      id: String(r.id),
      name: String(r.name),
      place: String(r.place),
    },
    geometry: {
      type: "Point" as const,
      coordinates: [Number(r.lon), Number(r.lat)],
    },
  }));
  const geojson = workPath("tiles/localities.geojson");
  await mkdir(workPath("tiles"), { recursive: true });
  await writeFile(
    geojson,
    JSON.stringify({ type: "FeatureCollection", features }),
  );

  const count = (p: Place) =>
    features.filter((f) => f.properties.place === p).length;
  const ids = new Set(features.map((f) => f.properties.id));
  const checks = {
    hasLocalities: features.length > 0,
    uniqueIds: ids.size === features.length,
    allNamed: features.every((f) => f.properties.name.trim() !== ""),
    allInsideBasin: features.length === inside.length,
  };
  await writeReport("localities", {
    ok: Object.values(checks).every(Boolean),
    checks,
    namedPlaceNodesInBbox: nodes.length,
    insideBasin: features.length,
    outsideBasinDropped: nodes.length - features.length,
    byPlace: Object.fromEntries(PLACES.map((p) => [p, count(p)])),
    note: "Place nodes only; places mapped only as areas are not included.",
    source: "© OpenStreetMap contributors, ODbL 1.0, via overpass-api.de",
    outputs: [rel(geojson)],
  });
  if (!Object.values(checks).every(Boolean))
    throw new Error(`localities checks failed: ${JSON.stringify(checks)}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
