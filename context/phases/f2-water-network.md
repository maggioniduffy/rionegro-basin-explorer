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

- [ ] F2.0 Phase file, PLAN row, DECISSIONS entry, SOURCES.md (Sentinel-2 L2A via Earth Search, GLO-30)
- [ ] F2.1 uv scaffold, config, CLI (required `--region`), acquisition (STAC, scene lock, windowed reads, cache, DEM)
- [ ] F2.2 Water mask, reservoirs, polygons
- [ ] F2.3 Network (skeleton graph, pruning, connectors, ports, orientation, shares); pytest: island arms,
      orientation, shares
- [ ] F2.4 Contract writer, `lib/flow/net-schema.ts` (+1 vitest), QA GeoJSON, `report.json`, README
- [ ] F2.5 Run on the 4 sections twice, reviewer gate, PR

## Done when

- `limay-110`: ≥ 2 parallel branches around ≥ 1 island, course coverage ≥ 0.95, no cycle, shares sum to 1 at
  every split, no reservoir.
- `limay-078`, `limay-096`: one reservoir over ≥ 90 % of the course chainage, with ports and drift; lake IoU
  reported (≥ 0.8 provisional).
- `neuquen-139`: branch vertices inside water ≥ 0.99, reported beside the same metric for the F1 track.
- Two runs give identical bytes; `npm run check` passes; `public/flow/nqn` and `data/out` are unchanged.

## Owner checks (local)

- [ ] `uv` installed; `npm run pipeline:flow-water -- --region nqn --only limay-110,limay-078,limay-096,neuquen-139`
      twice: `report.json` ok, outputs identical.
- [ ] Open `data/work/nqn/flow-water/out/*.qa.geojson` over imagery in QGIS: arms follow the water, reservoir
      outlines match the shore.
- [ ] `uv run --project pipeline/py pytest` green.

## Follow-ups

- **F3:** engine reads `flow-net/1` (branch tracks with junction hand-off, reservoir drift), publish budget and
  file format, then a full `nqn` run.
