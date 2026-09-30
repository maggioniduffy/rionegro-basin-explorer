# Data pipeline

TS scripts, run with `tsx`, that orchestrate DuckDB, GDAL/ogr2ogr and tippecanoe. Each step:

- is idempotent;
- reads from `data/raw/` or an earlier step's output in `data/work/`;
- writes a `report.json` (counts, total km, orphan segments, area checks) next to its output.

Final artifacts go to `data/out/`: PMTiles for the map and NDJSON for `npm run seed`.
Licenses and citations for every input are in [SOURCES.md](./SOURCES.md).

Status: **Phase 1 in progress.** `download` and `inspect` are implemented; the other steps are planned.

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

Disk: about 2.9 GB of archives (deleted after extraction) and about 8.2 GB extracted, of which the
global RiverATLAS FileGDB is 7 GB. A later step keeps only the basin's reaches.

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

Local-only inputs (not fetched by the pipeline): `data/raw/ign/` (IGN layers, for Phase 5) and
`data/raw/alos/` (one ALOS PALSAR scene, unused). See SOURCES.md.

## Planned steps (Phase 1, not yet implemented)

1. `pipeline:download`: fetch HydroRIVERS SA, HydroBASINS SA, and RiverATLAS (global) into `data/raw/`, with SHA-256 checksums.
2. `pipeline:basin`: traverse HydroBASINS upstream from the Río Negro mouth via `NEXT_DOWN`, then dissolve.
3. `pipeline:rivers`: clip reaches to the basin and join RiverATLAS attributes.
4. `pipeline:named`: trace the main stems and aggregate metrics. Names come from a manual `names.json`.
5. `pipeline:export`: write NDJSON for Mongo and GeoJSON, then PMTiles.

Rule: inspect every source schema before using attribute names. Never guess them.
