<!-- Phase file. Index and status: [PLAN.md](../PLAN.md). -->

# Phase I1 — Sharper imagery, water tuning, reservoirs and CDN cache

Merged phase (owner, 2026-10-19). It replaces the former `i1-sharper-imagery.md` and `b1-bucket-remote-pipelines.md`
(both in git history; B1 decisions in [DECISSIONS.md](../DECISSIONS.md#phase-b1-2026-10-19)). Branch
`phase-i1-imagery-water` from main.

## Context

B1.3 ran (remote batch). The water network works but the detection needs refining in hard places (braided
reaches, reservoirs). To refine it we need: (a) sharper imagery and more zoom to _see_ the truth, (b) a fast way to
_see_ what the detector does on a small box without running the whole pipeline, (c) a measured feedback loop with
the owner on 2–3 hard captures, and (d) the B1 leftovers: Vercel CDN cache (was B1.5) and whole reservoirs (was
B1.4), which should use the refined algorithm.

**B1 closed** with B1.1 (content on R2 through same-origin rewrites), B1.2 (`flow-water.yml` remote batches),
B1.3 (first remote batch) and the untrack of `public/tiles` and `public/flow` (`ab34d58`) done.

Key facts found:

- Detection: `pipeline/py/flowwater/` — `acquire.py` (windowed COG reads, `select_scenes` :147, `read_look` :221,
  `.npz` cache), `water.py` (`water_frequency` :68 builds MNDWI/NDVI/SCL internally and discards them;
  `close_padded`, `fill_small_holes`, `keep_corridor_components`, `reservoir_zone` callable one by one),
  `network.py` (`skeletonise` :164, `build_network` :903). Entry is per section (course-driven Grid, `build_grid`
  :102). No PNG/HTML output exists; matplotlib/pillow are only transitive deps.
- Imagery: base is EOX Sentinel-2 cloudless 2024 (~10 m, CC BY-NC-SA 4.0); `lib/map/style.ts:841` raster source,
  `IMAGERY_MAXZOOM=15`, `MAP_MAXZOOM=13`, `FLOW_MAXZOOM=14.5`, env `NEXT_PUBLIC_IMAGERY_TILE_URL/ATTRIBUTION`. Esri
  World Shaded Relief was already rejected (Esri terms need an ArcGIS subscription outside Esri software,
  DECISSIONS.md:472) — likely the same for World Imagery.
- The URL doesn't carry the camera (`lib/url-state.ts`), so a screenshot alone has no coordinates.
- `next.config.ts` headers: `Vercel-CDN-Cache-Control: no-store` on `/tiles|flow/:region/:version/:file`.

## Items (in order)

- [x] **I1.0 Imagery candidates and licenses** (license-checker, read-only). Runs in parallel with I1.6. For each
      candidate, record the resolution over the basin, whether it's free with no recurring cost (no tier that bills
      once traffic grows), whether a key or account is needed, whether a public non-commercial site may use it, the
      required attribution, whether the browser may fetch tiles directly, and **whether data may be derived from it**
      (owner-drawn truth polygons traced on it). Candidates (none verified yet):
  - Esri World Imagery (the reference app uses it; its terms are listed as unverified in F1 follow-ups).
  - IGN Argentina imagery or orthophoto services (WMS/WMTS), if any cover the basin.
  - Provincial services (Neuquén, Río Negro, Córdoba IDE orthophotos).
  - Mapbox / MapTiler satellite free tiers: they need a token and bill above a quota, so flag the cost risk (Rule 8).
  - Any other free ≤2 m source the checker finds.

  Output: a table for SOURCES.md and a recommendation. **Done 2026-10-19**: Esri and Mapbox bill with traffic;
  MapTiler Free is hard-capped but forbids server caching (plan B); IGN `mosaicos_vuelos` is free, keyless,
  CORS-enabled and allows tracing, but its coverage is patchy (none at El Chocón). Table in `pipeline/SOURCES.md`.

- [x] **I1.1 Owner decision on the provider**; record it in DECISSIONS.md and `pipeline/SOURCES.md`. Owner,
      2026-10-19: IGN `mosaicos_vuelos` above EOX, **`nqn` only** (`cba` keeps EOX; no Córdoba imagery pursued).
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
- [ ] **I1.T Tuning loop with the owner** (Opus + owner, data).
  1. Owner sends 2–3 hard captures + map URL (or coords). Each becomes a case.
  2. Truth: owner marks corrections (polygon or "missed arm here / false water here"); traced only on imagery whose
     license allows it (I1.0), else on Sentinel-2/EOX.
  3. Loop: probe → HTML (artifact) → owner feedback → change config or algorithm → probe all cases. Each round
     records metrics per case in the case's report; no change kept that lowers IoU on another case.
  4. Result: new `flow-water.config.json` values and/or algorithm changes (with `FLOWWATER_VERSION` bump),
     DECISSIONS.md entry with the before/after table. Rerun affected sections remotely (B1.2 workflow).

  Not reinforcement learning: a measured human-in-the-loop calibration; cases stay as regression checks.

  **Agent split to save tokens and load (owner, 2026-10-19):**
  - **Search is done by the probe, not by a model.** `--search key=a..b:step,...` runs a grid (or small random)
    search over config values on every case with truth, scored by IoU / FP / FN / missed branches, and writes a
    ranked `search.json` (top-N + per-case metrics). Bands are cached, so a search of tens of variants is CPU only.
  - **pipeline-runner** (Codex wrapper) runs probes and searches, reads `report.json` / `search.json`, and returns a
    ≤20-line table (variant, per-case IoU, FP, FN, regressions). It never pastes images or arrays. Max 2 agents at
    once (owner rule), and one writer per case dir.
  - **data-inspector** (Codex wrapper) answers cheap questions about a case's arrays (e.g. MNDWI histogram inside
    the owner's "missed arm" polygon) with DuckDB/numpy summaries.
  - **builder (Sonnet)** implements algorithm changes (new rule, new index) when a config change isn't enough.
  - **Opus** only reads the tables, picks the next hypothesis and decides what to keep. **The owner looks at the
    images** (HTML artifact); Opus looks at a stage PNG only when a table can't explain a failure.
  - Each round = one brief to the runner: cases, search space, metric to optimise, regression bound.
  - Possible later: a dedicated Codex agent for algorithm iteration under Opus control (owner, 2026-10-19), to be
    designed once I1.P is done.

- [ ] **I1.2 + I1.4 High-res source and more zoom** _(builder; reviewer: license, cost)_. Blocked by I1.1.
  - Add a second raster source (IGN `mosaicos_vuelos` WMTS, `pipeline/SOURCES.md`) that blends in above about
    z13–14, EOX Sentinel-2 below filling its gaps. `nqn` only; `cba` keeps EOX. Map the IGN footprint over the
    basin first (which reaches have tiles). Put its URL and attribution in env vars like `NEXT_PUBLIC_IMAGERY_TILE_URL`. Keep the attribution and
    the snapshot stamp (`lib/map/snapshot.ts`) correct for both sources.
  - Raise `MAP_MAXZOOM` (13) and `FLOW_MAXZOOM` (14.5, `lib/flow/config.ts`) to where the new imagery stays sharp
    (target z16–17 for flow, measured on screen, not guessed); set the raster source's `maxzoom` to the provider's
    real max so MapLibre overzooms rather than requesting tiles that don't exist.
  - HydroRIVERS lines drift off the imagery at close zoom (`lib/map/config.ts`): at high zoom, show only IGN lines
    and channel outlines, or fade the HydroRIVERS lines. Check the mask and the particle trail widths at the new
    zooms.
- [ ] **I1.3 Flow close-up and mask alignment check**: the F1 flow close-up and the mask still line up with the new
      imagery; drop the "soft imagery" note in the flow panel if it no longer applies.
- [ ] **I1.5 Particle density control** (independent, can go any time). Add a control in the flow bar
      (`components/flow/FlowControls.tsx`) to raise the particle count, e.g. 1× / 2× / 4× of `FLOW_PARTICLES` (3000
      per section today). It goes in the store with the playback speed, optionally as a URL param like `fs`, with
      labels in EN and ES. Resizing must reallocate the `ParticleState` buffers in `lib/flow/particles.ts` without
      restarting the section. Measure fps at 4× on a mid laptop before choosing the top option, and drop it if it goes
      below ~50 fps. With reduced motion, keep the default.
- [ ] **I1.6 Vercel CDN cache for tiles and flow (was B1.5)** _(reviewer: cost)_. Owner, 2026-10-19: use Vercel's
      cache, no custom domain. Since #13 nothing is cached: every PMTiles range goes through Vercel to r2.dev, which
      is rate-limited and "non-production". Scout Vercel's docs before building; approaches to verify, cheapest
      first:
  - The CDN caches the **whole object** and serves ranges from it: the rewrite (or a Route Handler) asks R2 without
    `Range` and returns a 200 with `s-maxage`/`Vercel-CDN-Cache-Control`. Works only if Vercel's CDN answers a
    `Range` request from a cached 200; that is the first thing to check.
  - Cache each range separately: a 206 keyed by URL + `Range` (`Vary: Range`, or the range moved into the URL by the
    client's PMTiles source). Only if Vercel honours that key; the cached rewrite in #12 did not.
  - A Route Handler slices ranges from a whole object held in Vercel's Runtime Cache or the `fetch` cache. Check item
    size limits against the largest file (cba `mask.pmtiles`, 8.5 MB) and the cost of a function invocation and
    Active CPU per range.

  Out: a custom domain (owner). Gate: on a Preview, at least three distinct ranges of one `.pmtiles` each return
  their own `content-range`, twice, and the second pass shows `x-vercel-cache: HIT`; the map and flow load with no
  console errors; cost flags updated.

- [ ] **I1.7 Whole reservoirs (was B1.4)** _(reviewer: data provenance)_. **After I1.T**, so it uses the tuned
      detection; the probe's reservoir-zone panel is used to check El Chocón before the remote rerun. Today the water
      mask is computed on the bounding box of a 1500 m buffer of each section's course (`corridorM`), so El Chocón's
      polygon ends in straight edges in open water (`limay-076..083`), and particles show only at zoom ≥ 12 for one
      section at a time.
  - Pipeline (Python), scope: El Chocón and Arroyito groups only. The index has 58 reservoir sections: Alicurá,
    Piedra del Águila, Pichi Picún Leufú, El Chocón and Arroyito on the Limay, plus `agrio-003` and `varvarco-001`.
    The others reuse the mechanism in later batches.
  - Reservoir **groups** in `flow-water.config.json` `lakes: [{id, hylakId, sections: "limay-076..limay-095"}]`,
    explicit and traceable to HydroLAKES ids. The ids are listed from `lakes.geojson`, and the owner confirms the
    member ranges.
    - A group runs the existing pipeline on a virtual section: the concatenated course of its members, with AOI =
      course buffer ∪ (lake polygon buffered by `lakeMarginM`).
    - One net per group (`lake-<hylakId>.net.json`); members point to it. Resolution stays 10 m unless the grid
      estimate exceeds a memory budget, in which case use `lakes[].resolutionM: 20` (measured first, reported).
    - `FLOWWATER_VERSION` bump.
  - Publish: `flow-net-pub` keeps `driftFrom` (orchestration §8 finding). `nets.json` gains
    `groups: {netId: [sectionIds]}`.
  - App (`lib/flow/data.ts`, network loading, flow view): a member section loads its group net and the camera fits
    the lake; a new display constant sets a lower minimum zoom for reservoir drift (exact value to set in the brief
    after reading the flow layer code); strings in both locales, if the panel changes.
  - Then rerun the groups remotely (`flow-water.yml`) and publish.
  - Acceptance: `npm run check`; one test for the group lookup (a section that maps to its group net, and one that
    doesn't). The report shows the El Chocón polygon IoU against HydroLAKES 981 over the whole lake, and no straight
    AOI edge in open water (QA: the polygon touches the grid border only on land). Owner browser pass.

- [ ] **I1.E — Flow-decision eval, review loop and label-free checks** (planned 2026-10-21, implement later).
  Refines branch/flow-direction decisions against a fixed corrected set (Limay + Neuquén sections). Complements
  I1.T (water-mask truth in GeoJSON): I1.E scores *decisions*, not mask pixels. Existing names are untouched.
  - **Reach = flow section** (`limay-076`, id from `public/flow/nqn/index.json`), optional `arm` = stable branch key
    (section id + branch start/end chainage `s[2]`; local `b0..` ids are unstable between runs).
  - Names: cases `regions/nqn/flow-eval/cases.json`; script `npm run pipeline:flow-eval -- --region nqn`
    (`--region` required). Not `pipeline/flow/fixtures/` or `pipeline:flow:eval`.
  - Case: `{reachId, arm?, correctDecision, errorType, correctedAt, split: "dev"|"holdout"}`; `errorType` in
    braided, flat, confluence, reservoir, anabranch, control. Sampled by type, split fixed by a deterministic hash
    and never moved; holdout reported only; no reach ids in the algorithm.
  - WP1 schema, validator and never-overwrite merge (existing `reachId`+`arm` kept, conflicts reported).
  - WP2 additive per-branch `confidence` and `features` (angle, Strahler via HYRIV match or null, width, DEM
    slope, distance to main channel) in `flow-net/1`; no model is trained, ML only when hundreds of corrections
    exist and rules conflict (then propose and wait for approval).
  - WP3 eval step: % correct overall / per errorType / per split, `data/work/nqn/flow-eval/report.json`
    (deterministic), non-zero exit when a previously correct case turns wrong; `n=0` with no labels.
  - WP4 review HTML: candidate arms with proposed flow, lowest confidence first; owner marks correct/incorrect
    plus error type; export merges without overwriting.
  - WP5 label-free checks in the report: cycles, outlet reachability, flow conservation at confluences; violations
    listed for unreviewed sections. Only sections with a net (11 of 910 today).
  - WP6 docs (`pipeline/README.md`, DECISSIONS.md). Python changes need `uv run pytest` (not in `npm run check`).
  - Plan file: `~/.claude/plans/crystalline-gathering-sutton.md`.

## Done when

- Probe: HTML for a known section; cached rerun; pipeline output unchanged on a done section.
- Tuning: per-case metrics table before/after recorded in DECISSIONS.md; remote rerun reports pass
  `flow-net-publish` checks.
- Imagery: in `nqn` (where IGN covers), the arms of a braided reach (e.g. the Río Negro near Choele Choel) are visible at
  z15–16; flow mode zooms past z14.5 with imagery that stays sharp; the provider's license is verified and recorded
  in SOURCES.md; there is no recurring cost; attribution shows on the map and in snapshots.
- The particle density control works in EN and ES and holds ~60 fps at the default.
- I1.6 Preview gate passes; I1.7 report and owner browser pass.
- `npm run check` green per WP (`uv run pytest` for the probe test); phase gate per orchestration §6.

## Recurring cost flags

- R2: $0 at about 30 MB. The risk is more than 10M Class B reads per month while uncached (until I1.6).
- I1.6: a Route Handler approach adds function invocations and Active CPU per range; to flag once chosen. No custom
  domain (owner, 2026-10-19).
- Actions: $0 while the repo is public. **If it goes private**: 2,000 min/month and 2-CPU runners.
- Imagery provider: must have no tier that bills with traffic (I1.0).

## Owner checks

- Camera hash (I1.P): open `/rionegro/map#14/-39.29/-65.66` → the camera lands there, not on the basin fit;
  `/rionegro/map?r=<river id>#13/-39.0/-68.0` → the river panel opens, the camera stays at the hash, and a later
  search pick fits as usual; `?flow=<section>#15/<lat>/<lon>` → flow opens at the hash; panning updates the hash and
  keeps `?r=`/`?flow=`; without a hash the initial fit is unchanged; `/cordoba/map#12/-31.4/-64.2` works too.
  **Passed (owner, 2026-10-19)** after `ef92883` (MapLibre's `map.remove()` deleted the hash on the dev remount).
  Zoom stays capped at 13 until I1.2. The probe ran from a pasted `--at` (fresh acquisition, 61 s).
- Probe: open `data/work/nqn/flow-water-probe/limay-110/index.html` and check the layers read right.

- Browser: zoom into the Río Negro near Choele Choel and the lower Limay at z15–16 in light and dark. The tiles
  should load without errors and the switch from Sentinel-2 should not be jarring.
