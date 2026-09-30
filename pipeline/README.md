# Data pipeline

TS scripts, run with `tsx`, that orchestrate DuckDB, GDAL/ogr2ogr and tippecanoe. Each step:

- is idempotent;
- reads from `data/raw/` or an earlier step's output in `data/work/`;
- writes a `report.json` (counts, total km, orphan segments, area checks) next to its output.

Final artifacts go to `data/out/`: PMTiles for the map and NDJSON for `npm run seed`.
Licenses and citations for every input are in [SOURCES.md](./SOURCES.md).

Status: **Phase 1 in progress.** `download`, `inspect`, `basin` and `rivers` are implemented; the other steps are planned.

## Prerequisites

| Tool       | Used for                           | Check                      |
| ---------- | ---------------------------------- | -------------------------- |
| DuckDB     | Reading, joins, geometry (spatial) | installed by `npm install` |
| `unzip`    | Extracting downloads               | `unzip -v`                 |
| tippecanoe | GeoJSON → PMTiles (Phase 2)        | `tippecanoe --version`     |

Install notes:

- **DuckDB**: the `@duckdb/node-api` devDependency. The spatial extension is fetched by DuckDB on
  first use (`INSTALL spatial`) and includes its own GDAL, so it reads Shapefile and FileGDB
  directly. System GDAL (`ogr2ogr`) is handy for ad-hoc checks but not required.
- **tippecanoe**: build from https://github.com/felt/tippecanoe (`make -j && sudo make install`). Recent versions write `.pmtiles` directly.

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

Local-only inputs (not fetched by the pipeline): `data/raw/ign/` (IGN layers, for Phase 5) and
`data/raw/alos/` (one ALOS PALSAR scene, unused). See SOURCES.md.

## Planned steps (Phase 1, not yet implemented)

1. `pipeline:download`: fetch HydroRIVERS SA, HydroBASINS SA, and RiverATLAS (global) into `data/raw/`, with SHA-256 checksums.
2. `pipeline:basin`: traverse HydroBASINS upstream from the Río Negro mouth via `NEXT_DOWN`, then dissolve.
3. `pipeline:rivers`: clip reaches to the basin and join RiverATLAS attributes.
4. `pipeline:named`: trace the main stems and aggregate metrics. Names come from a manual `names.json`.
5. `pipeline:export`: write NDJSON for Mongo and GeoJSON, then PMTiles.

Rule: inspect every source schema before using attribute names. Never guess them.
