<!-- Phase file (index). Index and status: [PLAN.md](../PLAN.md). Item details live in `i1/`. -->

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

**Detector principle (owner, 2026-10-28):** water detection learns once and generalizes; no per-section thresholds,
rules or overrides. Extending to other rivers should mostly come down to setting up their courses and sections.
Details in [i1-t-tuning.md](i1/i1-t-tuning.md).

## Items

Read this index, then **only the file of the item you are working on**. IDs and checkboxes are the source of truth
here; the detail, acceptance and done-notes of each item are in its file.

| Status | Item                                                      | File                                                            |
| ------ | --------------------------------------------------------- | --------------------------------------------------------------- |
| [x]    | I1.0 Imagery candidates and licenses                      | [i1-0-1-imagery-license.md](i1/i1-0-1-imagery-license.md)       |
| [x]    | I1.1 Owner decision on provider (IGN, `nqn` only)         | [i1-0-1-imagery-license.md](i1/i1-0-1-imagery-license.md)       |
| [x]    | I1.P Water probe (`flow-water probe`)                     | [i1-p-probe.md](i1/i1-p-probe.md)                               |
| [ ]    | I1.T Tuning loop with the owner (mask + flow decisions)   | [i1-t-tuning.md](i1/i1-t-tuning.md)                             |
| [ ]    | I1.2 + I1.4 High-res source and more zoom (blocked: I1.1) | [i1-2-highres-imagery.md](i1/i1-2-highres-imagery.md)           |
| [ ]    | I1.3 Flow close-up and mask alignment check               | [i1-2-highres-imagery.md](i1/i1-2-highres-imagery.md)           |
| [ ]    | I1.5 Particle density control (independent)               | [i1-5-particle-density.md](i1/i1-5-particle-density.md)         |
| [ ]    | I1.6 Vercel CDN cache for tiles and flow                  | [i1-6-cdn-cache.md](i1/i1-6-cdn-cache.md)                       |
| [ ]    | I1.7 Whole reservoirs (after I1.T)                        | [i1-7-reservoirs.md](i1/i1-7-reservoirs.md)                     |
|        | Recurring cost flags and owner checks                     | [i1-costs-and-owner-checks.md](i1/i1-costs-and-owner-checks.md) |
|        | Water source options (MODIS, DSWx, JRC, HLS)              | [i1-water-source-options.md](i1/i1-water-source-options.md)     |

Order: I1.T before I1.7; I1.2 needs I1.1 (done); I1.3 follows I1.2; I1.5 and I1.6 can go any time.

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
