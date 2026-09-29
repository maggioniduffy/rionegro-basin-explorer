# Data pipeline

TS scripts, run with `tsx`, that orchestrate DuckDB, GDAL/ogr2ogr and tippecanoe. Each step:

- is idempotent;
- reads from `data/raw/` or an earlier step's output in `data/work/`;
- writes a `report.json` (counts, total km, orphan segments, area checks) next to its output.

Final artifacts go to `data/out/`: PMTiles for the map and NDJSON for `npm run seed`.
Licenses and citations for every input are in [SOURCES.md](./SOURCES.md).

Status: **not started.** The steps below are the Phase 1 plan from `PLAN.md`.

## Prerequisites

| Tool       | Used for                         | Check                  |
| ---------- | -------------------------------- | ---------------------- |
| GDAL       | Format conversion, reprojection  | `ogr2ogr --version`    |
| DuckDB     | Summary queries, joins (spatial) | `duckdb --version`     |
| tippecanoe | GeoJSON → PMTiles                | `tippecanoe --version` |

Install notes:

- **GDAL**: `sudo apt install gdal-bin` (already present on the dev machine).
- **DuckDB**: download the CLI from https://duckdb.org/docs/installation/. The spatial extension loads with `INSTALL spatial; LOAD spatial;`.
- **tippecanoe**: build from https://github.com/felt/tippecanoe (`make -j && sudo make install`). Recent versions write `.pmtiles` directly.

## Planned steps (Phase 1)

1. `pipeline:download`: fetch HydroRIVERS SA, HydroBASINS SA, and RiverATLAS (global) into `data/raw/`, with SHA-256 checksums.
2. `pipeline:basin`: traverse HydroBASINS upstream from the Río Negro mouth via `NEXT_DOWN`, then dissolve.
3. `pipeline:rivers`: clip reaches to the basin and join RiverATLAS attributes.
4. `pipeline:named`: trace the main stems and aggregate metrics. Names come from a manual `names.json`.
5. `pipeline:export`: write NDJSON for Mongo and GeoJSON, then PMTiles.

Rule: inspect every source schema before using attribute names. Never guess them.
