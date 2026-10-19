<!-- Phase file. Index and status: [PLAN.md](../PLAN.md). -->

# Phase F2 — Water network from Sentinel-2 (`nqn`): pipeline and contract

Plan approved 2026-10-18 ([DECISSIONS.md](../DECISSIONS.md#phase-f2-water-network-2026-10-18)). Branch `phase-f2-water-network`.

F1 moves particles along one track per section (the IGN course with a wet span). Braided arms are lost, reservoirs
are a fast 1D line, and dams leave dry gaps. F2 adds an offline Python step that derives, per flow section, a
multi-branch channel network and reservoir polygons from Sentinel-2 L2A (10 m) and the Copernicus GLO-30 DEM.

## Owner decisions (2026-10-18)

- **Scope: pipeline and contract only.** The F1 particle engine is not changed; reading the network in the
  engine (branch hand-off at junctions, slow 2D drift in reservoirs) is phase F3.
- **Source: Earth Search on AWS** (Element84 STAC `sentinel-2-l2a` COGs; Copernicus DEM GLO-30 on AWS Open Data).
  No account or key.
- **Validation sections:** `limay-110` (Plottier, braided), `limay-078` (El Chocón), `limay-096` (Arroyito),
  `neuquen-139` (meanders).

## Design summary

- **Step:** `npm run pipeline:flow-water -- --region nqn [--only <id,…>]`, a uv project in `pipeline/py/`
  (`flowwater` package). Config `regions/<id>/flow-water.config.json`.
- **Input:** each section's stations and bbox from `public/flow/<id>/<sectionId>.json` (the IGN course, source to
  mouth). Read only.
- **Water:** per scene `MNDWI > 0 & NDVI < 0.1` on SCL-valid pixels; water where the frequency over the pinned
  scenes is ≥ 0.5 with ≥ 3 valid looks; 3×3 closing; components touching the course corridor; small holes filled.
- **Reservoirs:** EDT half-width > 250 m cores, dilated within water where EDT > 180 m, ≥ `minReservoirKm2`;
  polygon with island holes, ports, drift vector.
- **Network:** skeleton (`skan`) → `MultiGraph` (keeps both arms of an island); spur pruning against local width;
  branches under 30 m median width dropped; connectors across dam gaps along the course; orientation by course
  chainage, then DEM, then course tangent; capacity W̄^1.5 shares (illustrative), flux from the source.
- **Output:** `data/work/<id>/flow-water/out/<sectionId>.net.json` (schema `flow-net/1`, zod in
  `lib/flow/net-schema.ts`), `<sectionId>.qa.geojson`, `report.json`. Nothing goes to `public/` in F2 (the flow
  budget is 7.6 of 8 MB).

## Work packages

- [x] F2.0 Phase file, PLAN row, DECISSIONS entry, SOURCES.md (Sentinel-2 L2A via Earth Search, GLO-30)
- [x] F2.1 uv scaffold, config, CLI (required `--region`), acquisition (STAC, scene lock, windowed reads, cache, DEM)
- [x] F2.2 Water mask, reservoirs, polygons
- [x] F2.3 Network (skeleton graph, pruning, connectors, ports, orientation, shares); pytest: island arms,
      orientation, shares
- [x] F2.4 Contract writer, `lib/flow/net-schema.ts` (+1 vitest), QA GeoJSON, `report.json`, README
- [~] F2.5 Run on the 4 sections twice (identical), reviewer gate (pass with fixes, fixed), PR

## Done when

- `limay-110` (braided): ≥ 2 parallel branches around ≥ 1 island, wet-course coverage ≥ 0.95, no cycle, shares
  sum to 1 at every split, no reservoir. **Met** (5 arms, 1.0, 0, 1e-16).
- `limay-078`, `limay-096` (reservoirs): one reservoir over ≥ 90 % of the course chainage, with drift, and ports
  where a channel meets it; lake IoU reported (≥ 0.8 provisional). **Met** (100 % / 0.832; 91 % / 0.877).
- `neuquen-139` (meanders): branch points inside water ≥ 0.99 beside the F1 track's figure, and wet-course
  coverage ≥ 0.95. **Partly met**: 1.0 against 0.777, but wet-course coverage 0.776 and one cycle (see
  DECISSIONS, validation result); carried to F3.
- Two runs give identical bytes; `npm run check` passes; `public/flow/nqn` and `data/out` are unchanged. **Met.**

## Owner checks (local)

- [x] `uv` installed; `npm run pipeline:flow-water -- --region nqn --only limay-110,limay-078,limay-096,neuquen-139`
      twice: `report.json` ok, outputs identical.
- [x] Open `data/work/nqn/flow-water/out/*.qa.geojson` over imagery in QGIS: arms follow the water, reservoir
      outlines match the shore (owner, 2026-10-18: ok).
- [x] `limay-096` r0 (0.67 km² at s = 0, off the course) is the El Chocón outflow above Arroyito (owner,
      2026-10-18).
- [x] The `neuquen-139` reservoir (HydroLAKES 122976, unnamed) is not El Chañar, which lies a few km downstream
      (owner, 2026-10-18). Its name is unknown.
- [x] `uv run --project pipeline/py pytest` green (6 passed, 2026-10-18).

## Follow-ups

- **neuquen-139 gaps:** connect course-following stubs (connectors) before pruning dead ends; split reservoir hubs
  into in/out so a bay crossing is not a cycle.
- **Drift north:** `drift` assumes UTM grid north is true north (fine near -69°, about 4° off at -63° on
  EPSG:32719); correct for convergence before a full `nqn` run.
- **SCL class 2:** in baseline 04.00 or later it is topographic shadow; measure how much water it adds in Andean
  sections before the full run.
- **GLO-30 licence document** not read; read it before F3 publishes anything derived from the DEM.
- **F3:** engine reads `flow-net/1` (branch tracks with junction hand-off, reservoir drift), publish budget and
  file format, then a full `nqn` run.
