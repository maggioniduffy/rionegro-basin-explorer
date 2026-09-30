/**
 * pipeline:osm-names — name evidence for each candidate from OpenStreetMap.
 *
 * One Overpass request downloads the named waterways and water bodies (with
 * geometry) in the basin's bounding box; it is cached in
 * data/work/osm-names/overpass.json, so reruns send nothing. Then, locally, for each
 * candidate segment (data/work/candidates/candidates.json) up to SAMPLE_POINTS reach
 * midpoints spread along it are matched to OSM lines within RADIUS_M. Names are
 * tallied per point ("Río Limay: 5/5 points"). This is evidence for a person to
 * review when writing pipeline/names.json, not an automatic naming.
 *
 * OSM data is ODbL 1.0, © OpenStreetMap contributors (see SOURCES.md).
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import { lit, openDb } from "../lib/duckdb";
import { requireInput } from "../lib/inputs";
import { evenlySpaced, tallyNames } from "../lib/names";
import { rel, workPath } from "../lib/paths";
import { writeReport } from "../lib/report";

// Node tries IPv6/IPv4 addresses with a 250 ms per-attempt timeout by default, which
// is too short for overpass-api.de from here (ETIMEDOUT); curl was fine.
net.setDefaultAutoSelectFamilyAttemptTimeout(2000);

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const USER_AGENT =
  "rio-negro-basin-explorer-pipeline/0.1 (one-off name lookup, cached)";
const SAMPLE_POINTS = 5;
const RADIUS_M = 750;
/** Margin around the basin bbox, in degrees. */
const BBOX_MARGIN = 0.05;

interface Candidate {
  rank: number;
  mouthReach: number;
  uplandKm2: number;
  parentMouthReach: number | null;
  mouth: { lat: number; lon: number; osm: string };
  segment: number[];
}

type LatLon = { lat: number; lon: number };
interface OsmElement {
  type: "way" | "relation";
  id: number;
  tags?: Record<string, string>;
  geometry?: LatLon[];
  members?: { type: string; geometry?: LatLon[] }[];
}

interface Bbox {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
}

async function fetchOverpass(
  bbox: Bbox,
  cacheFile: string,
): Promise<OsmElement[]> {
  if (existsSync(cacheFile)) {
    console.log(`Overpass: cached ${rel(cacheFile)}`);
    return (
      JSON.parse(await readFile(cacheFile, "utf8")) as {
        elements: OsmElement[];
      }
    ).elements;
  }
  const b = `${bbox.ymin - BBOX_MARGIN},${bbox.xmin - BBOX_MARGIN},${bbox.ymax + BBOX_MARGIN},${bbox.xmax + BBOX_MARGIN}`;
  const query = `[out:json][timeout:600][bbox:${b}];
(
  way["waterway"~"^(river|stream|canal)$"]["name"];
  relation["waterway"="river"]["name"];
  way["natural"="water"]["name"];
  relation["natural"="water"]["name"];
);
out tags geom;`;
  // 429 and 504 ("server too busy") are load on the public instance: back off.
  const waitsMin = [1, 2, 4];
  for (let attempt = 0; ; attempt++) {
    console.log("Overpass: one bbox request (may take a few minutes)...");
    const res = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ data: query }),
      signal: AbortSignal.timeout(15 * 60_000),
    });
    const text = await res.text();
    if (res.ok) {
      await writeFile(cacheFile, text);
      return (JSON.parse(text) as { elements: OsmElement[] }).elements;
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

const lineWkt = (pts: LatLon[]) =>
  `LINESTRING(${pts.map((p) => `${p.lon} ${p.lat}`).join(",")})`;

async function main() {
  const candidates = JSON.parse(
    await readFile(
      requireInput(workPath("candidates/candidates.json")),
      "utf8",
    ),
  ) as Candidate[];
  const reachesFile = requireInput(workPath("rivers/reaches.parquet"));
  const basinReport = JSON.parse(
    await readFile(requireInput(workPath("basin/report.json")), "utf8"),
  ) as { polygon: { bbox: Bbox } };
  const outDir = workPath("osm-names");
  await mkdir(outDir, { recursive: true });
  const elements = await fetchOverpass(
    basinReport.polygon.bbox,
    `${outDir}/overpass.json`,
  );

  // Every named element as lines: a way's own geometry, or a relation's members.
  const lines = elements.flatMap((e) => {
    const name = e.tags?.name;
    if (!name) return [];
    const kind = e.tags?.waterway ? "waterway" : "water";
    const parts =
      e.type === "way"
        ? [e.geometry ?? []]
        : (e.members ?? []).map((m) => m.geometry ?? []);
    return parts
      .filter((p) => p.length >= 2)
      .map((p) => ({ name, kind, osm: `${e.type}/${e.id}`, wkt: lineWkt(p) }));
  });
  const linesFile = `${outDir}/lines.ndjson`;
  await writeFile(
    linesFile,
    lines.map((l) => JSON.stringify(l)).join("\n") + "\n",
  );

  const picks = candidates.flatMap((c) =>
    evenlySpaced(c.segment, SAMPLE_POINTS).map((reach, i) => ({
      rank: c.rank,
      reach,
      i,
    })),
  );
  const albers = (g: string) =>
    `ST_Transform(${g}, 'EPSG:4326', 'ESRI:102033', always_xy := true)`;
  const db = await openDb();
  let hits;
  try {
    await db.conn.run(`
      CREATE TABLE osm AS
      SELECT name, kind, osm, ${albers("ST_GeomFromText(wkt)")} AS g
      FROM read_json(${lit(linesFile)}, format = 'newline_delimited')`);
    await db.conn.run(`
      CREATE TABLE picks AS SELECT * FROM (VALUES ${picks.map((p) => `(${p.rank}, ${p.i}, ${p.reach})`).join(",")})
      AS t(rank, i, reach)`);
    await db.conn.run(`
      CREATE TABLE points AS
      SELECT p.rank, p.i, ${albers("ST_LineInterpolatePoint(r.geom, 0.5)")} AS g
      FROM picks p JOIN ${lit(reachesFile)} r ON r.HYRIV_ID = p.reach`);
    hits = await db.all(`
      SELECT p.rank, p.i, o.kind, o.name
      FROM points p JOIN osm o ON ST_DWithin(p.g, o.g, ${RADIUS_M})
      GROUP BY ALL`);
  } finally {
    db.close();
  }

  const matches = candidates.map((c) => {
    const n = Math.min(SAMPLE_POINTS, c.segment.length);
    const perPoint = (kind: string) =>
      Array.from({ length: n }, (_, i) =>
        hits
          .filter(
            (h) =>
              Number(h.rank) === c.rank && Number(h.i) === i && h.kind === kind,
          )
          .map((h) => String(h.name)),
      );
    const waterways = tallyNames(perPoint("waterway"));
    const top = waterways[0];
    return {
      rank: c.rank,
      mouthReach: c.mouthReach,
      parentMouthReach: c.parentMouthReach,
      uplandKm2: c.uplandKm2,
      samplePoints: n,
      topName: top?.name ?? null,
      topPoints: top?.points ?? 0,
      waterways,
      waterBodies: tallyNames(perPoint("water")),
      osm: c.mouth.osm,
    };
  });
  const matchesFile = `${outDir}/matches.json`;
  await writeFile(matchesFile, JSON.stringify(matches, null, 2) + "\n");

  const unanimous = matches.filter(
    (m) => m.topName && m.topPoints === m.samplePoints,
  );
  const unnamed = matches.filter((m) => !m.topName);
  await writeReport("osm-names", {
    candidates: matches.length,
    samplePoints: picks.length,
    osmNamedElements: elements.length,
    osmLines: lines.length,
    unanimous: unanimous.length,
    partial: matches.length - unanimous.length - unnamed.length,
    noWaterwayName: unnamed.length,
    radiusM: RADIUS_M,
    source: "© OpenStreetMap contributors, ODbL 1.0, via overpass-api.de",
    outputs: [rel(matchesFile)],
  });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
