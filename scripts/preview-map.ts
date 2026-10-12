/**
 * preview:map — one self-contained HTML map of a region's working data (dev only).
 *
 *   npm run preview:map -- --region cba
 *
 * Writes data/work/<region>/preview/preview.html (gitignored). It opens straight from
 * file://: MapLibre (bundled from node_modules, worker included) and the GeoJSON layers
 * are inlined; only the EOX basemap tiles come from the network. Reads the cba gate and
 * basin outputs; the HydroRIVERS layer is added when rivers/reaches.parquet exists.
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { openDb, lit, type Db } from "../pipeline/lib/duckdb";
import {
  rawPath,
  regionFile,
  REGION_ID,
  ROOT,
  workPath,
} from "../pipeline/lib/paths";

const SIMPLIFY_LINE = 0.0005;
const SIMPLIFY_POLY = 0.001;
const MAPLIBRE = path.join(ROOT, "node_modules/maplibre-gl/dist");

interface Layer {
  id: string;
  label: string;
  color: string;
  kind: "fill" | "line";
  on: boolean;
  data: string; // GeoJSON FeatureCollection text
  count: number;
}

/** Read only the two imagery keys from .env.local, else .env.example. */
function imageryEnv() {
  for (const f of [".env.local", ".env.example"]) {
    const file = path.join(ROOT, f);
    if (!existsSync(file)) continue;
    const out: Record<string, string> = {};
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = /^(NEXT_PUBLIC_IMAGERY_(?:TILE_URL|ATTRIBUTION))=(.*)$/.exec(
        line,
      );
      if (m?.[1] && m[2] !== undefined)
        out[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, "$2");
    }
    const url = out.NEXT_PUBLIC_IMAGERY_TILE_URL;
    if (url) return { url, attribution: out.NEXT_PUBLIC_IMAGERY_ATTRIBUTION };
  }
  throw new Error(
    "NEXT_PUBLIC_IMAGERY_TILE_URL not found in .env.local/.env.example",
  );
}

/** Round coordinates to 5 decimals (about 1 m). */
const round5 = (s: string) =>
  s.replace(/-?\d+\.\d{6,}/g, (n) => String(Number(Number(n).toFixed(5))));

/** Run a query returning `props` (JSON text) and `g` (GeoJSON text) as a FeatureCollection. */
async function collection(db: Db, sql: string) {
  const rows = await db.all(sql);
  const features = rows.map(
    (r) =>
      `{"type":"Feature","properties":${r.props},"geometry":${round5(String(r.g))}}`,
  );
  return {
    data: `{"type":"FeatureCollection","features":[${features.join(",")}]}`,
    count: rows.length,
  };
}

const vsizip = (file: string) => `/vsizip/${file}`;
const poly = (g: string) =>
  `ST_AsGeoJSON(ST_SimplifyPreserveTopology(${g}, ${SIMPLIFY_POLY}))`;
/** APRHI shapefiles are EPSG:22174; always_xy keeps lon/lat order. */
const read = (file: string) => `ST_Read(${lit(file)})`;
const aprhiGeom =
  "ST_MakeValid(ST_Transform(geom, 'EPSG:22174', 'EPSG:4326', always_xy := true))";

async function buildLayers(db: Db): Promise<Layer[]> {
  const config = JSON.parse(
    await readFile(regionFile("gate.config.json"), "utf8"),
  );
  const geo = (f: string) => workPath("basin", f);
  const out: Layer[] = [];
  const add = (
    l: Omit<Layer, "data" | "count">,
    c: { data: string; count: number },
  ) => out.push({ ...l, ...c });

  add(
    {
      id: "outline",
      label: "Region outline",
      color: "#ffffff",
      kind: "line",
      on: true,
    },
    await collection(
      db,
      `
      SELECT to_json({name: name})::VARCHAR AS props, ${poly("geom")} AS g
      FROM ST_Read(${lit(geo("basin.geojson"))})`,
    ),
  );
  add(
    {
      id: "basins",
      label: "APRHI basins (6)",
      color: "#4aa3ff",
      kind: "fill",
      on: true,
    },
    await collection(
      db,
      `
      SELECT to_json({code: code, name: name})::VARCHAR AS props, ${poly("geom")} AS g
      FROM ST_Read(${lit(geo("basins.geojson"))})`,
    ),
  );
  add(
    {
      id: "province",
      label: "Province edge (IGN)",
      color: "#ffd24a",
      kind: "line",
      on: true,
    },
    await collection(
      db,
      `
      SELECT to_json({name: ${config.province.nameField}})::VARCHAR AS props, ${poly("geom")} AS g
      FROM ST_Read(${lit(vsizip(rawPath(config.province.path)))},
        open_options=['ENCODING=${config.province.encoding}'])
      WHERE ${config.province.nameField} = ${lit(config.province.name)}`,
    ),
  );
  add(
    {
      id: "lines",
      label: "APRHI water lines (dashed: under review)",
      color: "#3df5ff",
      kind: "line",
      on: true,
    },
    await collection(
      db,
      `
      SELECT to_json({name: name, type: class, status: status})::VARCHAR AS props,
        ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, ${SIMPLIFY_LINE})) AS g
      FROM '${workPath("lines-gate/lines_province.parquet")}'
      WHERE source = 'aprhi' AND coalesce(status, '') <> 'Eliminado'`,
    ),
  );
  for (const [id, label, key, color, name] of [
    [
      "subbasins",
      "APRHI subcuencas (25)",
      "referenceSubbasins",
      "#ff9f4a",
      "SUBCUENCA",
    ],
    ["ugh", "APRHI UGH (80)", "ugh", "#d96bff", "SISTEMA"],
  ] as const) {
    const file =
      key === "ugh"
        ? rawPath("UnidadesDeGestion_hidrica_CPA.zip")
        : rawPath(config[key].path);
    add(
      { id, label, color, kind: "line", on: false },
      await collection(
        db,
        `
        SELECT to_json({name: ${name}})::VARCHAR AS props, ${poly(aprhiGeom)} AS g
        FROM ${read(vsizip(file))}`,
      ),
    );
  }
  const reaches = workPath("rivers/reaches.parquet");
  if (existsSync(reaches))
    add(
      {
        id: "network",
        label: "HydroRIVERS, order 3+ (blue connected, red endorheic)",
        color: "#2f7bff",
        kind: "line",
        on: false,
      },
      await collection(
        db,
        `
        SELECT to_json({id: HYRIV_ID, strahler: ORD_STRA, network: network})::VARCHAR AS props,
          ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, ${SIMPLIFY_LINE})) AS g
        FROM '${reaches}' WHERE ORD_STRA >= 3`,
      ),
    );
  return out;
}

/** Bundle MapLibre (ESM, split worker) into a global script and a worker source. */
async function bundleMaplibre() {
  const one = async (entry: string, globalName?: string) => {
    const r = await build({
      entryPoints: [path.join(MAPLIBRE, entry)],
      bundle: true,
      write: false,
      minify: true,
      format: "iife",
      globalName,
      legalComments: "none",
    });
    return r.outputFiles[0]?.text ?? "";
  };
  return {
    lib: await one("maplibre-gl.mjs", "maplibregl"),
    worker: await one("maplibre-gl-worker.mjs"),
  };
}

const PAGE = (p: {
  css: string;
  lib: string;
  worker: string;
  layers: Layer[];
  bounds: number[];
  tiles: string;
  attribution: string;
}) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${REGION_ID} map preview</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>${p.css}
html,body,#map{margin:0;height:100%}body{font:13px system-ui,sans-serif}
#panel{position:absolute;top:10px;left:10px;background:#fffd;padding:8px 10px;border-radius:6px;z-index:2;max-width:300px}
#panel label{display:flex;gap:6px;align-items:center;margin:3px 0;cursor:pointer}
#panel i{width:14px;height:0;border-top:3px solid;flex:none}#panel i.f{height:10px;border:2px solid;opacity:.8}
#panel i.d{border-top-style:dashed}</style></head>
<body><div id="map"></div><div id="panel"><b>${REGION_ID} preview</b></div>
<script>${p.lib}</script>
<script>
const LAYERS = ${JSON.stringify(p.layers.map((l) => ({ ...l, data: undefined })))};
const DATA = {${p.layers.map((l) => `${JSON.stringify(l.id)}:${l.data}`).join(",")}};
const workerSrc = ${JSON.stringify(p.worker)};
maplibregl.setWorkerUrl(URL.createObjectURL(new Blob([workerSrc], {type: "text/javascript"})));
const RAND = ["#4aa3ff","#ff6b6b","#7be26b","#ffb84a","#c58bff","#4ae0c4"];
const sources = {eox: {type: "raster", tiles: [${JSON.stringify(p.tiles)}], tileSize: 256, maxzoom: 15,
  attribution: ${JSON.stringify(p.attribution + " | Fuente: Portal de Información Hídrica de Córdoba (APRHI) | IGN | HydroSHEDS")}}};
const layers = [{id: "eox", type: "raster", source: "eox"}];
for (const l of LAYERS) {
  sources[l.id] = {type: "geojson", data: DATA[l.id]};
  const vis = {visibility: l.on ? "visible" : "none"};
  if (l.kind === "fill") {
    layers.push({id: l.id, type: "fill", source: l.id, layout: vis, paint: {
      "fill-color": ["match", ["get", "code"], ...["01","02","03","04","05","06"].flatMap((c, i) => [c, RAND[i]]), "#888"],
      "fill-opacity": 0.2}});
    layers.push({id: l.id + "-edge", type: "line", source: l.id, layout: vis, paint: {"line-color": "#fff", "line-width": 1}});
    layers.push({id: l.id + "-label", type: "symbol", source: l.id, layout: {...vis, "text-field": ["concat", ["get", "code"], " ", ["get", "name"]], "text-size": 12},
      paint: {"text-color": "#fff", "text-halo-color": "#000", "text-halo-width": 1.5}});
  } else if (l.id === "lines") {
    for (const [suffix, dash] of [["", false], ["-rev", true]])
      layers.push({id: l.id + suffix, type: "line", source: l.id, layout: vis,
        filter: dash ? ["==", ["get", "status"], "En revisión"] : ["!=", ["get", "status"], "En revisión"],
        paint: {"line-color": l.color, "line-width": 1.5, ...(dash ? {"line-dasharray": [2, 2]} : {})}});
  } else {
    layers.push({id: l.id, type: "line", source: l.id, layout: vis, paint: {
      "line-color": l.id === "network" ? ["match", ["get", "network"], "endorheic", "#ff4a4a", l.color] : l.color,
      "line-width": l.id === "outline" ? 3 : 1.5}});
  }
}
const map = new maplibregl.Map({container: "map", style: {version: 8, sources, layers,
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf"}, bounds: ${JSON.stringify(p.bounds)}, fitBoundsOptions: {padding: 30}});
map.addControl(new maplibregl.NavigationControl());
const panel = document.getElementById("panel");
for (const l of LAYERS) {
  const row = document.createElement("label");
  row.innerHTML = '<input type="checkbox"' + (l.on ? " checked" : "") + '><i class="' + (l.kind === "fill" ? "f" : l.id === "lines" ? "d" : "") + '" style="color:' + l.color + '"></i>' + l.label;
  row.firstChild.onchange = (e) => {
    const v = e.target.checked ? "visible" : "none";
    for (const x of layers) if (x.id === l.id || x.id.startsWith(l.id + "-")) map.setLayoutProperty(x.id, "visibility", v);
  };
  panel.append(row);
}
map.on("click", (e) => {
  const ids = ["lines", "lines-rev", "network", "basins"].filter((i) => map.getLayer(i));
  const f = map.queryRenderedFeatures([[e.point.x - 4, e.point.y - 4], [e.point.x + 4, e.point.y + 4]], {layers: ids})[0];
  if (!f) return;
  const html = Object.entries(f.properties).map(([k, v]) => "<b>" + k + "</b>: " + v).join("<br>");
  new maplibregl.Popup().setLngLat(e.lngLat).setHTML(html).addTo(map);
});
map.on("mousemove", (e) => {
  const hit = map.queryRenderedFeatures(e.point, {layers: ["lines", "lines-rev"]}).length;
  map.getCanvas().style.cursor = hit ? "pointer" : "";
});
</script></body></html>`;

function bounds(outline: string) {
  const xs: number[] = [];
  const ys: number[] = [];
  JSON.stringify(
    JSON.parse(outline).features[0].geometry.coordinates,
    (_k, v) => {
      if (Array.isArray(v) && v.length === 2 && typeof v[0] === "number") {
        xs.push(v[0]);
        ys.push(v[1]);
      }
      return v;
    },
  );
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

async function main() {
  if (REGION_ID !== "cba") {
    console.error(
      `preview:map has layers for cba only so far; got --region ${REGION_ID}`,
    );
    process.exit(1);
  }
  const imagery = imageryEnv();
  const db = await openDb();
  let layers: Layer[];
  try {
    layers = await buildLayers(db);
  } finally {
    db.close();
  }
  const { lib, worker } = await bundleMaplibre();
  const css = await readFile(path.join(MAPLIBRE, "maplibre-gl.css"), "utf8");
  const outline = layers[0];
  if (!outline) throw new Error("no outline layer");
  const html = PAGE({
    css,
    lib,
    worker,
    layers,
    bounds: bounds(outline.data),
    tiles: imagery.url,
    attribution: imagery.attribution ?? "EOX Sentinel-2 cloudless",
  });
  // the data placeholders in LAYERS are not used by the page; keep it small
  const file = workPath("preview/preview.html");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, html);
  const mb = (n: number) => `${(n / 1e6).toFixed(2)} MB`;
  for (const l of layers)
    console.log(
      `${l.id.padEnd(10)} ${String(l.count).padStart(6)} features  ${mb(l.data.length)}`,
    );
  if (!layers.some((l) => l.id === "network"))
    console.log("network    skipped (no rivers/reaches.parquet)");
  console.log(`wrote ${file}  ${mb(Buffer.byteLength(html))}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
