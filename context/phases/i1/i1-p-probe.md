<!-- Phase file. Index: [i1-imagery-water.md](../i1-imagery-water.md) · Plan: [PLAN.md](../../PLAN.md) -->

# I1.P — Water probe (done)

- [x] **I1.P Water probe (`flow-water probe`)** _(builder; reviewer: data provenance)_. Goal:
      `npm run pipeline:flow-water-probe -- --region nqn --case <name> | --bbox lon1,lat1,lon2,lat2 [--section <id>] [--set water.mndwiMin=0.05 ...] [--sweep key=a,b,c] [--truth file.geojson]`
      writes `data/work/<region>/flow-water-probe/<case>/index.html` + `report.json` in seconds.
  - `acquire.py`: `grid_from_bbox(cfg, bbox)` (same snapping as `build_grid`); reuse `select_scenes`, `get_lock`,
    `read_look`; cache looks as `.npz` under the case dir.
  - `water.py`: extract the per-look loop of `water_frequency` into
    `look_indices(cfg, look) -> (mndwi, ndvi, valid, wet)`, used by both `water_frequency` and the probe (pipeline
    output must stay byte-identical — check on one done section: same `net.json` hash, no `FLOWWATER_VERSION`
    bump).
  - `probe.py` (new): runs stages explicitly and renders one PNG per stage: RGB per look, MNDWI, NDVI, SCL dropped,
    frequency, threshold mask, closed, holes filled, corridor-kept (only with `--section`; else "all components"),
    reservoir zones, skeleton + network (pruned spurs in another colour). `--sweep` → variants side by side;
    `--search` → ranked `search.json` (see I1.T). `--truth` → IoU, false-positive/negative area, missed branches;
    overlay. Single self-contained HTML (inline PNGs, layer toggles, opacity slider). Declare matplotlib/pillow in
    `pyproject.toml` + `uv.lock`.
  - Cases registry: `regions/nqn/flow-water.cases.json` (`{name, bbox, section?, truth?}`) and
    `regions/nqn/flow-water-cases/<name>.truth.geojson`, committed (small; each truth records how it was drawn).
  - Camera in URL: enable MapLibre's built-in `hash` option (`#z/lat/lon`) so the owner can paste a map URL; probe
    accepts `--at "<url or z/lat/lon>" --size-km 3`. Verify no clash with `UrlSync` (query only).
  - Acceptance: `npm run check`; one pytest: `look_indices` equals the old inline computation on a synthetic look;
    probe run on a known section bbox (e.g. `limay-110`) produces the HTML; second run uses the cache (no network).
  - Output is local/gitignored; one can be published as a private artifact for review.
  - **Done 2026-10-19** (`eecd20e` refactor, `cc7ead1` probe, `5eab304` search, `9493c39` map hash). limay-110
    outputs byte-identical before/after; `--case limay-110` takes ~4 s from the pipeline cache (read-only crop) and
    matches the pipeline (1.329 km², 16 branches); a 12-variant `--search` takes 0.2 s. Reviewer: pass, six
    advisories fixed. Usage in `pipeline/README.md`.
