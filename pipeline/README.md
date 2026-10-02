# Data pipeline

TS scripts, run with `tsx`, that orchestrate DuckDB, GDAL/ogr2ogr and tippecanoe. Each step:

- is idempotent;
- reads from `data/raw/` or an earlier step's output in `data/work/`;
- writes a `report.json` (counts, total km, orphan segments, area checks) next to its output.

Final artifacts: NDJSON for `npm run seed` in `data/out/`, and PMTiles for the map in `public/tiles/`
(committed, because Vercel serves them from `/public` and tippecanoe does not run there).
Licenses and citations for every input are in [SOURCES.md](./SOURCES.md).

Status: Phase 1 is complete (`download` … `export`). Phase 2 adds `mask` and `tiles`; Phase 4 adds
`subbasins` (run it after `export` and before `tiles`).

## Prerequisites

| Tool       | Used for                           | Check                      |
| ---------- | ---------------------------------- | -------------------------- |
| DuckDB     | Reading, joins, geometry (spatial) | installed by `npm install` |
| `unzip`    | Extracting downloads               | `unzip -v`                 |
| tippecanoe | GeoJSON → PMTiles (`tiles`)        | `tippecanoe --version`     |

Install notes:

- **DuckDB**: the `@duckdb/node-api` devDependency. The spatial extension is fetched by DuckDB on
  first use (`INSTALL spatial`) and includes its own GDAL, so it reads Shapefile and FileGDB
  directly. System GDAL (`ogr2ogr`) is handy for ad-hoc checks but not required.
- **tippecanoe**: build from https://github.com/felt/tippecanoe; recent versions write `.pmtiles`
  directly. The build needs the SQLite headers. Without sudo (dev machine, 2026-09-30,
  tippecanoe v2.82.0): build the SQLite amalgamation from https://www.sqlite.org/download.html
  (check its SHA3-256 against that page) into `~/.local/{include,lib}/`, then run
  `CFLAGS=-I$HOME/.local/include CXXFLAGS=-I$HOME/.local/include LDFLAGS=-L$HOME/.local/lib make -j tippecanoe tippecanoe-decode tile-join`
  and copy the three binaries to `~/.local/bin`. `pipeline:tiles` uses `tippecanoe` from PATH,
  or `$TIPPECANOE`.

Disk: the global FileGDBs are large: RiverATLAS is 7 GB and GIRES is 3.3 GB extracted.
`pipeline:rivers` caches the basin's rows from each to Parquet. After that, the FileGDB folders can be
deleted; on the dev machine they have been. If the reach selection changes, the step asks for the
source again: remove `data/raw/<id>/.source.json` and rerun `pipeline:download`.

## Steps

### `npm run pipeline:download`

Fetches the sources listed in `pipeline/sources.ts` into `data/raw/<id>/`, extracts them and deletes
the archive. SHA-256 of each archive is recorded in the committed `pipeline/checksums.json`
(`downloadedAt` is a UTC date). Extracted folders carry a `.source.json` marker with the checksum, so
reruns skip finished sources. If upstream re-uploads a file and its checksum changes, the step fails;
review the change, then rerun with `-- --accept-new` to record the new checksum.

### `npm run pipeline:inspect`

Writes one JSON file per layer to `data/work/inspect/`: columns and types, feature count, CRS, extent
and three sample rows. `data/work/inspect/report.json` summarizes all layers. **Later steps only use
attribute names that appear there.**

### `npm run pipeline:basin`

Delineates the basin from HydroBASINS level 12. Configuration is in `pipeline/basin.config.json`.

1. **Outlet.** Picks the sea-draining HydroRIVERS reach (`NEXT_DOWN = 0`) with the largest
   `UPLAND_SKM` inside a search box and reports it with the runners-up.
2. **Members.** Takes the level-12 polygon holding that reach plus everything upstream via
   `NEXT_DOWN`, and checks that this equals the `MAIN_BAS` group.
3. **Dissolve and measure.** Writes `data/work/basin/basin.geojson` and `hybas_l12.parquet`.

Area has two definitions. HydroBASINS links some endorheic sinks to the surrounding basin through
a "virtual" `NEXT_DOWN` (TechDoc v1c), and `UP_AREA` excludes those regions:

- **total**: every traversed polygon; this is the outline written to `basin.geojson`.
- **connected**: only polygons with surface flow to the outlet (`ENDO = 0`).

The report compares the outlet's `UP_AREA`, the sums of `SUB_AREA`, and the dissolved polygon's
geodesic and Albers areas. It also checks the result against `reference.areaKm2` ± `tolerancePct`.

### `npm run pipeline:rivers`

Selects every HydroRIVERS reach whose `HYBAS_L12` is a basin member and tags each one with a
`network` value:

- `connected`: drains to the Río Negro outlet.
- `endorheic`: in an inland drainage inside the basin outline.

The map can use `network` to hide endorheic reaches, and network traversal skips them. Nothing is
filtered by flow. HydroRIVERS keeps intermittent streams, but no v1.0 source labels them.

It then adds GIRES flow-intermittence predictions (`predprob1`, `predcat1`, `predprob30`,
`predcat30`) with a left join. GIRES has no prediction for zero-flow reaches, which stay null.

It also joins every RiverATLAS column by `HYRIV_ID`. The first run scans the global FileGDB (about
3 minutes) and caches the basin subset to `data/work/rivers/riveratlas_basin.parquet`, keyed by a
hash of the reach IDs. After that the 7 GB FileGDB is only needed if the basin changes.

The report checks:

- orphans (a downstream ID outside the selection);
- a single connected outlet;
- completeness against the outlet's `MAIN_RIV`;
- a midpoint-in-polygon cross-check;
- a 1:1 join with matching shared fields (float32 tolerance for `LENGTH_KM` and `UPLAND_SKM`);
- `LENGTH_KM` against geodesic length.

### `npm run pipeline:candidates`

Lists the major branches of the connected network so they can be named in `pipeline/names.json`
(HydroRIVERS has no names). A candidate is either the outlet reach, or a branch at a confluence where
at least two branches drain ≥ 2,000 km² (`-- --min-area=<km²>` to change). Both branches of such a
confluence are listed. Each candidate's segment runs up the largest branch to the next candidate
confluence. Segments do not overlap. Writes `data/work/candidates/candidates.json`
(with OpenStreetMap links at each mouth) and `candidates.geojson` for a GIS viewer.

### `npm run pipeline:osm-names`

Name evidence from OpenStreetMap (ODbL; see SOURCES.md). The step makes **one** Overpass request
for the named waterways and water bodies in the basin bbox, cached in
`data/work/osm-names/overpass.json`, so reruns send nothing. It retries on 429 and 504, which the
public instance returns when busy. Each candidate segment gets up to five sample points, matched
locally to OSM lines within 750 m. `matches.json` lists the names per candidate, such as
"Río Limay 5/5". A person reviews it to write `pipeline/names.json`.

### `npm run pipeline:named`

Traces every river in `pipeline/names.json`, a hand-approved list keyed by mouth reach, with OSM
evidence for each name. A river starts at its mouth. At each confluence it takes the largest-area
branch that is not another named river's mouth, and it stops at a headwater or where every branch is
named (`source.kind = "confluence"`). The step writes `data/out/rivers.ndjson` (committed; seed input)
and `data/work/named/river_reaches.parquet` (reach → river).

Each document carries per-field provenance:

- **Length:** sum of `LENGTH_KM`.
- **Mouth elevation:** `ele_mt_cmn` of the mouth reach.
- **Source elevation:** the headwater reach's `ele_mt_cmn` plus its own drop.
- **Drop:** source elevation minus mouth elevation.
- **Discharge at the mouth:** `DIS_AV_CMS`, modeled.
- **Non-perennial share:** GIRES, modeled.

The sum of per-reach drops is reported only as a diagnostic, because it overstates on flat braided
reaches.

Checks: unique IDs, no reach in two rivers, every river flows into a named river or the sea, and
exactly one river reaches the sea.

### `npm run pipeline:lakes`

HydroLAKES v1.0 polygons that intersect the basin, clipped to it. The first run scans the global
shapefile once and caches its basin-bbox subset in `data/work/lakes/hydrolakes_bbox.parquet`.

HydroRIVERS draws flow paths across lakes, and this step removes those lines from the map.

- **Every lake:** the parts of reaches inside it are cut away.
- **Exception:** the reservoirs approved in `pipeline/lakes.json` keep the line of their main river.
  The main river is the named river (`pipeline:named`) of the lake's largest-`UPLAND_SKM` reach,
  i.e. its outflow path.
- **Slivers:** clipped pieces under 50 m are dropped, since they are artifacts where a line grazes a
  shore.
- **Reach data is unchanged.** Only the geometry drawn on the map changes, and `export` uses it.

`candidates.json` lists the reservoirs (`Lake_type` 2) and controlled lakes (3) that have a named
main river, for review. Approved entries go into `lakes.json` with evidence. The step fails if an
approved entry's river disagrees with the data.

The report checks:

- every lake geometry is valid;
- the approved lakes match the data;
- the main river inside each approved lake is unchanged (within 0.5%).

It also lists the km removed and the largest lakes. The step writes `lakes.geojson`, which is used for
the mask hole and the `lakes` outline layer.

### `npm run pipeline:export`

Writes the Phase 1 artifacts:

- `data/out/reaches.ndjson`: one document per reach (gitignored, about 3 MB).
- `data/work/tiles/reaches.geojson` and `basin.geojson`: tippecanoe inputs for Phase 2.
- `data/out/report.json`: the combined, committed report. It covers counts, km, orphans, the area
  check and the named rivers.

Only RiverATLAS fields whose catalog units were checked are exported (`ele_mt_cmn`, `sgr_dk_rav`).

### `npm run pipeline:mask`

Polygons for the "Visible Land" slider, from `pipeline/map.config.json`. For each level in
`mask.baseHalfWidthKm`, every reach is buffered on each side by that width times
`mask.strahlerFactor[order]`, in South America Albers (ESRI:102033). Endorheic reaches are included.
The buffers are unioned and clipped to the basin to make the visible "hole". The mask is the
`bounds` rectangle minus the hole. A final level uses the whole basin as the hole. The app sets the
same `bounds` as the map's `maxBounds`, so the edge of the mask is never on screen. Lakes from
`pipeline:lakes` are part of the visible hole at every level.

Output: `data/work/tiles/mask.geojson`. The report lists each level's visible area, its % of the
basin and its vertex count. It checks that every geometry is valid, that the visible area grows
with each level, and that the last level is the whole basin.

### `npm run pipeline:subbasins`

Builds the sub-basin hierarchy listed in `pipeline/subbasins.config.json` from HydroBASINS level 12.
The root (`negro`) is the whole basin; level 1 is `limay`, `neuquen` and `endorheic`.

1. **Sets.** A river node is the level-12 polygon holding its river's `mouthReach` plus
   everything upstream via `NEXT_DOWN`. Below the root, endorheic polygons (`ENDO > 0`) are left
   out, even where HydroBASINS links them to the river virtually: they drain to closed depressions.
   The `endorheic` node holds all of them (23,163 km² in 17 parts).
2. **Partition.** A node's own area is its set minus its children's sets. The own areas must
   partition the basin: their areas sum to the outline, with no overlaps or gaps over 1 km².
3. **Reaches.** Assigned by `HYBAS_L12`. The connected reaches of each river node must equal the
   HydroRIVERS upstream set of its mouth reach, and every endorheic reach must lie in an endorheic
   polygon (and no connected reach in one).
4. **Metrics.** Summed or `CATCH_SKM`-weighted over RiverATLAS catchment attributes (`pop_ct_csu`,
   `lka_pc_cse`, `inu_pc_cmn/cmx`, `ele_mt_cmn/cmx`), endorheic catchments included. Over the
   connected reaches they must reproduce the upstream values at the mouth, which confirms the units.

Outputs: `data/out/subbasins.ndjson` (committed, seed input) and `data/work/tiles/subbasins.geojson`
(own areas, one feature per sub-basin, for tiles).

### `npm run pipeline:ign-gate`

Read-only measurement for the gate before Phase 5: what do IGN's watercourse lines add over
HydroRIVERS? Nothing it writes feeds the app. Needs the IGN line layers unzipped in
`data/raw/ign/lineas_de_aguas_continentales_perenne/` (required) and `..._intermitente/`
(optional; skipped if missing), plus `basin`, `rivers` and `named`. Layer origin and terms:
[SOURCES.md](./SOURCES.md). It runs in about 2 minutes; set `IGN_GATE_PROXIMITY=perennial` to skip
the intermittent class in the proximity part.

1. **Clip.** IGN lines touching the basin, exact duplicates dropped, clipped to the basin polygon
   (`ign_basin.parquet`). Km are spheroid km; the bbox figure is reported too.
2. **Names.** Share of features and km with `fna`; IGN km under each approved river name against
   that river's HydroRIVERS km (a cross-check on lengths).
3. **Proximity** (Albers, so distances are approximate), at 100, 250 and 500 m: IGN km farther
   than the buffer from every HydroRIVERS reach; HydroRIVERS km (by Strahler order) farther than
   it from every IGN line of a class; and HydroRIVERS km with no river name today that lie within
   it of a named IGN line. This is a proximity bound, not the Phase 5 matcher.
4. **Verdict.** The PLAN.md rule at 250 m (IGN km beyond the buffer is at least 20% of IGN perennial
   km and at least 10% of HydroRIVERS km), with the same figures at the other buffers.

Output: `data/work/ign-gate/report.json`. Checks: IGN present, HydroRIVERS km equals the `rivers`
report, clipped km within bbox km, deduplication never adds features. The overlap figure (unioned vs
summed length) is computed for the perennial class only.

### `npm run pipeline:tiles`

Runs tippecanoe with the feature and tile-size limits off, except for the mask (below):

- `public/tiles/rivers.pmtiles`: layer `reaches`, with the properties the map styles on and a
  per-feature minzoom from `reachMinzoomByStrahler`; layer `basin`, the outline.
- `public/tiles/mask.pmtiles`: layer `mask`, one feature per level, and layer `endorheic`. Built
  in two parts joined with `tile-join`: z0–7 at `--full-detail=10` (about 2 tile units per screen
  pixel), z8 and up at full detail, both with `--detect-shared-borders` and a 100 KB tile cap.
  tippecanoe lowers an oversized tile's detail rather than dropping features, and fails if it still
  doesn't fit. This keeps the worst tile near 75k vertices instead of ~274k (z6), which MapLibre
  would otherwise triangulate on every tile load while zooming. `tile-join` must be on PATH next to
  tippecanoe.
- `public/tiles/subbasins.pmtiles`: layer `subbasins`, the own areas from `pipeline:subbasins`,
  built with `--detect-shared-borders` so simplification leaves no slivers between neighbours.

The report decodes the tiles back. It checks that every reach is present from its minzoom up and
never before it. The only exception is a reach shorter than one tile unit at that zoom (an eighth of
a pixel), which tippecanoe drops because it collapses to a point. It also checks that every mask
level and every sub-basin is present at each checked zoom, and records file sizes and the tippecanoe version.

Full run order: `download` → `inspect` → `basin` → `rivers` → `candidates` → `osm-names` → `named` →
`lakes` → `export` → `mask` → `tiles`.

## Tools

### `npm run inspect:file -- <path> [--layer=<name>] [--samples=<n>]`

Profiles one file without dumping it: columns and types, row count, DuckDB `SUMMARIZE` stats (null
%, min/max, approximate distinct values, mean), geometry types, extent and invalid count, and three
sample rows without geometry. It reads Parquet, CSV, NDJSON and anything GDAL opens (GeoJSON,
Shapefile, or a FileGDB with `--layer`). The full profile goes to
`data/work/inspect/adhoc/<file>.json`. The `inspect-dataset` skill and the `data-inspector` agent
(`.claude/`) use it.

### `npm run inspect:tiles -- <file.pmtiles> [--by=<prop>]`

Per-zoom summary of a PMTiles archive: tile count, stored tile bytes (min / median / max) and,
per layer, features and vertices (total and worst tile). `--by=level` splits the mask's vertices
by level. Use it to check tile weight after changing `pipeline:tiles` flags.

Local-only inputs (not fetched by the pipeline): `data/raw/ign/` (IGN layers, for Phase 5) and
`data/raw/alos/` (one ALOS PALSAR scene, unused). See SOURCES.md.

Rule: inspect every source schema before using attribute names. Never guess them.
