/**
 * pipeline:effluent-net — the compact river subgraph the effluent screening model walks (phase E1).
 *
 * Reads regions/<id>/effluent.config.json (hand-edited, sourced) and data/out/<id>/reaches.ndjson,
 * whose `nextDown` is already the effective link (pipeline:rivers applies the cuts and
 * network-overrides.json to NEXT_DOWN; the raw link is HR_NEXT_DOWN, not exported). The subgraph is
 * the config's mouth reach plus everything upstream of it (lib/graph.ts). Each reach is assigned a
 * gauge: those upstream of `gaugeSplit.upstreamOfReach` (excluding it) take `gaugeSplit.gauge`,
 * the rest `gaugeSplit.default`.
 *
 * Per gauge it fetches GloFAS v4's own daily discharge at the gauge cell from the Open-Meteo Flood API
 * (requested 1984–2022; non-null from 1997-01-01 at these cells; the model scales HydroRIVERS' mean by
 * today's flow / this climatology). Raw responses are cached in
 * data/work/<id>/effluent-net/glofas/<gauge>_<lat>_<lon>.json (the cell is in the name, so moving a
 * cell refetches) and reused when present, so reruns are offline and the output is byte-identical
 * (no timestamp in it; the report has one).
 *
 * Outputs: regions/<id>/effluent-net.json (committed), data/work/<id>/effluent-net/report.json.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import readline from "node:readline";
import * as prettier from "prettier";
import { upstreamIndex, upstreamSet } from "../lib/graph";
import { OUT_DIR, REGION_ID, regionFile, rel, workPath } from "../lib/paths";
import { writeReport } from "../lib/report";

const STEP = "effluent-net";
const CLIMATOLOGY_FROM = "1984-01-01";
const CLIMATOLOGY_TO = "2022-07-31";
const FLOOD_API = "https://flood-api.open-meteo.com/v1/flood";
const FETCH_TIMEOUT_MS = 60_000;
const RATE_LIMIT_WAIT_S = 65;
const RATE_LIMIT_RETRIES = 3;
// The API returns nulls before 1997-01-01 for these cells (probe 2026-10-29: 9,343 non-null days to 2022-07-31).
const MIN_CLIMATOLOGY_DAYS = 9_000;
const MAX_FILE_BYTES = 300_000;

interface Gauge {
  id: string;
  name: string;
  cell: { lat: number; lon: number };
  source: string;
}
interface EffluentConfig {
  mouthReach: number;
  gauges: Gauge[];
  gaugeSplit: { upstreamOfReach: number; gauge: string; default: string };
  lake: {
    id: string;
    inReaches: number[];
    outReach: number;
    [k: string]: unknown;
  };
  outfalls: { id: string; reach: number }[];
}
interface Reach {
  id: number;
  nextDown: number;
  lengthKm: number | null;
  dischargeM3s: number | null;
  gradientMPerKm: number | null;
  uplandKm2: number | null;
}
interface FloodResponse {
  latitude: number;
  longitude: number;
  daily: { time: string[]; river_discharge: (number | null)[] };
}

const round = (x: number, digits: number) => Number(x.toFixed(digits));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function readConfig(): Promise<EffluentConfig> {
  const file = regionFile("effluent.config.json");
  if (!existsSync(file))
    throw new Error(
      `no effluent.config.json for region "${REGION_ID}" (${rel(file)} missing); the effluent model is only configured for regions that have one`,
    );
  return JSON.parse(await readFile(file, "utf8")) as EffluentConfig;
}

async function readReaches(): Promise<Map<number, Reach>> {
  const file = `${OUT_DIR}/reaches.ndjson`;
  if (!existsSync(file))
    throw new Error(`${rel(file)} missing; run pipeline:export first`);
  const byId = new Map<number, Reach>();
  const lines = readline.createInterface({ input: createReadStream(file) });
  for await (const line of lines) {
    if (line.trim() === "") continue;
    const r = JSON.parse(line) as Record<string, unknown>;
    const num = (k: string) => (r[k] == null ? null : Number(r[k]));
    byId.set(Number(r._id), {
      id: Number(r._id),
      nextDown: Number(r.nextDown),
      lengthKm: num("lengthKm"),
      dischargeM3s: num("dischargeM3s"),
      gradientMPerKm: num("gradientMPerKm"),
      uplandKm2: num("uplandKm2"),
    });
  }
  return byId;
}

/** GET the climatology, waiting out Open-Meteo's per-minute limit; any other error fails the step. */
async function fetchClimatology(g: Gauge): Promise<{
  body: FloodResponse;
  cached: boolean;
}> {
  const cache = workPath(
    STEP,
    "glofas",
    `${g.id}_${g.cell.lat}_${g.cell.lon}.json`,
  );
  if (existsSync(cache))
    return {
      body: JSON.parse(await readFile(cache, "utf8")) as FloodResponse,
      cached: true,
    };
  const url =
    `${FLOOD_API}?latitude=${g.cell.lat}&longitude=${g.cell.lon}&daily=river_discharge` +
    `&start_date=${CLIMATOLOGY_FROM}&end_date=${CLIMATOLOGY_TO}`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const text = await res.text();
    let json: { error?: boolean; reason?: string } | null = null;
    try {
      json = JSON.parse(text) as { error?: boolean; reason?: string };
    } catch {
      /* non-JSON body: handled below */
    }
    const limited =
      res.status === 429 ||
      (json?.error === true && /minutely/i.test(json.reason ?? ""));
    if (limited) {
      if (attempt >= RATE_LIMIT_RETRIES)
        throw new Error(
          `Open-Meteo rate limit for ${g.id} after ${RATE_LIMIT_RETRIES} retries: ${json?.reason ?? res.status}`,
        );
      console.log(
        `${g.id}: rate limited, waiting ${RATE_LIMIT_WAIT_S} s (retry ${attempt + 1}/${RATE_LIMIT_RETRIES})`,
      );
      await sleep(RATE_LIMIT_WAIT_S * 1000);
      continue;
    }
    if (!res.ok || json === null || json.error === true)
      throw new Error(
        `Open-Meteo Flood API failed for ${g.id}: HTTP ${res.status} ${json?.reason ?? text.slice(0, 200)}`,
      );
    const daily = (json as unknown as Partial<FloodResponse>).daily;
    if (
      !Array.isArray(daily?.time) ||
      !Array.isArray(daily.river_discharge) ||
      daily.time.length === 0 ||
      daily.time.length !== daily.river_discharge.length
    )
      throw new Error(
        `Open-Meteo Flood API returned no usable daily.time / daily.river_discharge for ${g.id}`,
      );
    await mkdir(workPath(STEP, "glofas"), { recursive: true });
    await writeFile(cache, text);
    return { body: json as unknown as FloodResponse, cached: false };
  }
}

function summarize(body: FloodResponse) {
  const { time, river_discharge: q } = body.daily;
  let days = 0;
  let sum = 0;
  let from: string | null = null;
  let to: string | null = null;
  for (let i = 0; i < time.length; i++) {
    const v = q[i];
    if (v == null) continue;
    days++;
    sum += v;
    from ??= time[i]!;
    to = time[i]!;
  }
  return {
    meanM3s: days > 0 ? round(sum / days, 3) : null,
    days,
    from,
    to,
  };
}

/** True when every reach's nextDown walk reaches `mouth` without leaving the set or cycling. */
function walkEndsAtMouth(
  ids: Set<number>,
  next: Map<number, number>,
  mouth: number,
): boolean {
  const ok = new Map<number, boolean>([[mouth, true]]);
  for (const start of ids) {
    const path: number[] = [];
    const onPath = new Set<number>();
    let cur = start;
    let result: boolean | undefined;
    while (result === undefined) {
      const known = ok.get(cur);
      if (known !== undefined) result = known;
      else if (onPath.has(cur) || !ids.has(cur)) result = false;
      else {
        onPath.add(cur);
        path.push(cur);
        cur = next.get(cur) ?? 0;
      }
    }
    for (const p of path) ok.set(p, result);
    if (!result) return false;
  }
  return true;
}

async function main() {
  const config = await readConfig();
  const reaches = await readReaches();
  const mouth = config.mouthReach;
  if (!reaches.has(mouth))
    throw new Error(`mouthReach ${mouth} is not in reaches.ndjson`);

  const index = upstreamIndex(
    [...reaches.values()].map((r) => ({ id: r.id, nextDown: r.nextDown })),
  );
  const ids = upstreamSet(index, mouth);
  const gaugeIdx = new Map(config.gauges.map((g, i) => [g.id, i]));
  const idxOf = (id: string) => {
    const i = gaugeIdx.get(id);
    if (i === undefined)
      throw new Error(`gaugeSplit names unknown gauge "${id}"`);
    return i;
  };
  const splitGauge = idxOf(config.gaugeSplit.gauge);
  const defaultGauge = idxOf(config.gaugeSplit.default);
  if (!ids.has(config.gaugeSplit.upstreamOfReach))
    throw new Error(
      `gaugeSplit.upstreamOfReach ${config.gaugeSplit.upstreamOfReach} is not in the subgraph`,
    );
  const split = upstreamSet(index, config.gaugeSplit.upstreamOfReach);
  split.delete(config.gaugeSplit.upstreamOfReach);

  // The links the model walks stay inside the set; only the mouth leaves it.
  const mouthLeavesSet = !ids.has(reaches.get(mouth)!.nextDown);
  const sorted = [...ids].sort((a, b) => a - b);
  const next = new Map<number, number>();
  let linksStayInSet = mouthLeavesSet;
  const rows = sorted.map((id) => {
    const r = reaches.get(id)!;
    // The mouth reach flows on outside the subgraph; the model's walk ends there.
    const nextDown = id === mouth ? 0 : r.nextDown;
    next.set(id, nextDown);
    if (id !== mouth && !ids.has(r.nextDown)) linksStayInSet = false;
    const gauge = split.has(id) ? splitGauge : defaultGauge;
    return [
      id,
      nextDown,
      r.lengthKm,
      r.dischargeM3s,
      r.gradientMPerKm,
      r.uplandKm2,
      gauge,
    ];
  });
  const perGauge = config.gauges.map(
    (_, i) => rows.filter((r) => r[6] === i).length,
  );

  const gauges = [];
  const gaugeReport = [];
  for (const g of config.gauges) {
    const { body, cached } = await fetchClimatology(g);
    const climatology = summarize(body);
    // The API echoes the grid cell with float noise (-31.424997); the grid is 0.05° and the cell centres are offset by 0.025°.
    const snapped = {
      lat: round(body.latitude, 3),
      lon: round(body.longitude, 3),
    };
    gauges.push({
      id: g.id,
      name: g.name,
      cell: g.cell,
      source: g.source,
      snapped,
      climatology,
    });
    gaugeReport.push({
      id: g.id,
      cached,
      snapped,
      snappedMatchesConfig:
        snapped.lat === g.cell.lat && snapped.lon === g.cell.lon,
      ...climatology,
    });
  }

  const doc = {
    generatedBy: "pipeline:effluent-net",
    region: REGION_ID,
    source:
      "HydroRIVERS v1.0 (dischargeM3s = DIS_AV_CMS 1971–2000), RiverATLAS gradient; edited links; GloFAS v4 via Open-Meteo Flood API (climatology)",
    columns: [
      "id",
      "nextDown",
      "lengthKm",
      "dischargeM3s",
      "gradientMPerKm",
      "uplandKm2",
      "gauge",
    ],
    reaches: rows,
    gauges,
    lake: config.lake,
    outfalls: config.outfalls.map((o) => ({ id: o.id, reach: o.reach })),
  };
  // Formatted as the repo's prettier would (npm run check), so the committed file stays check-clean.
  const out = await prettier.format(JSON.stringify(doc), {
    ...(await prettier.resolveConfig(regionFile("effluent-net.json"))),
    parser: "json",
  });
  const outFile = regionFile("effluent-net.json");
  await writeFile(outFile, out);
  const fileBytes = Buffer.byteLength(out);

  const lakeIn = config.lake.inReaches;
  const checks = {
    reachCount: rows.length > 1,
    linksStayInSet,
    walksEndAtMouth: walkEndsAtMouth(ids, next, mouth),
    lakeReachesPresent:
      ids.has(config.lake.outReach) &&
      lakeIn.every(
        (id) => ids.has(id) && next.get(id) === config.lake.outReach,
      ),
    outfallReachesPresent: config.outfalls.every((o) => ids.has(o.reach)),
    gaugesHaveClimatology: gauges.every(
      (g) =>
        g.climatology.days >= MIN_CLIMATOLOGY_DAYS &&
        (g.climatology.meanM3s ?? 0) > 0,
    ),
    snappedMatchesConfig: gaugeReport.every((g) => g.snappedMatchesConfig),
    bothGaugesUsed: perGauge.every((n) => n > 0),
    fileBytes: fileBytes < MAX_FILE_BYTES,
  };
  const ok = Object.values(checks).every(Boolean);
  await writeReport(STEP, {
    region: REGION_ID,
    ok,
    checks,
    reachCount: rows.length,
    mouthReach: mouth,
    reachesPerGauge: Object.fromEntries(
      config.gauges.map((g, i) => [g.id, perGauge[i]]),
    ),
    gauges: gaugeReport,
    climatologyRange: { from: CLIMATOLOGY_FROM, to: CLIMATOLOGY_TO },
    output: rel(outFile),
    fileBytes,
  });
  if (!ok) throw new Error(`checks failed: ${JSON.stringify(checks)}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
