# PLAN.md — Río Negro Basin Explorer

Status legend: `[ ]` todo · `[~]` in progress · `[x]` done.
Work one phase at a time. Each phase ends in something usable.

## Goal

A dark, minimal satellite explorer of the Río Negro basin: only the river system
and a strip of land around it is visible, with river panels and a sub-basin view
(Limay, Neuquén, Río Negro, then finer levels). UI in English and Spanish.

## Architecture decisions

- **No separate backend.** Next.js App Router. Mongo is read from Server Components and Route Handlers only. Singleton Mongo client for serverless connection reuse.
- **Geometry as vector tiles (PMTiles), metadata in Mongo.** Each tile feature carries an id that maps to a Mongo document. Click → `queryRenderedFeatures` → fetch panel data. Mongo is used for metadata, hierarchy and search; for purely static data a JSON file would also work, so keep Mongo only if search/hierarchy justify it.
- **Map:** MapLibre GL JS with the PMTiles protocol (free, no token).
- **"Visible land" mask (prototype):** black overlay with a precomputed river-buffer "hole" at a few widths, driven by the slider. Fallback if edges/performance are poor: a raster reveal grid with a custom tile protocol, as in Amazon Basin Explorer.
- **Imagery:** tile URL from an env var so the provider can be swapped. Verify the license/attribution terms of the chosen provider (Esri World Imagery is the reference app's choice) before a public deploy.
- **Data pipeline:** TS scripts (`tsx`) orchestrating DuckDB, GDAL/ogr2ogr and tippecanoe. Python only if DEM-based delineation is needed.
- **i18n:** next-intl without i18n routing: no locale in the URL, the locale lives in the `NEXT_LOCALE` cookie (fallback `Accept-Language`, then `es`), messages in `/messages`. Verify current next-intl version/API against the docs when installing. Proper nouns are not translated; units toggle km/mi independently of locale.
- **State:** Zustand synced to URL (`?r=<river>&s=<subbasin>&lang` via route).
- **Hosting/cost:** Vercel + Atlas M0. PMTiles in `/public` if small, otherwise object storage with HTTP Range support. Check limits and pricing for each before committing.
- **Phase 0 decisions (2026-09-29):**
  - Imagery: undecided until Phase 2. EOX is recorded in `SOURCES.md` (CC BY-NC-SA, verified); Esri's terms are still unverified.
  - PMTiles: `/public` for now, pending a Range-request check on Vercel and the actual size after Phase 1.
  - Region: São Paulo for Atlas and Vercel, if the free Atlas tier (M0) is offered there.
  - Deploy: GitHub repo + Vercel Git integration.
  - CI: GitHub Actions runs `npm run check`. Playwright stays local until Phase 2.
  - `/api/health` pings Mongo to prove the wiring.
  - Dark theme is the default.
- **Phase 1 decisions (2026-09-30):**
  - Basin area shown in the app is the computed HydroBASINS polygon area, which includes the endorheic parts virtually linked to the basin: 136,204 km².
  - AIC's 140,000 km² ("La Cuenca" page, a rounded figure) is only a sanity check, ±10%. The latest result is −2.7%.
  - The surface-connected area (113,040 km², matching HydroBASINS `UP_AREA`) stays in the report as context.
  - DuckDB comes from the npm package `@duckdb/node-api`.
  - Only small outputs are committed (`report.json`, `rivers.ndjson`). `reaches.ndjson` and GeoJSON are regenerated locally.
  - Raw data is not stored in the cloud; `pipeline/checksums.json` pins the inputs.
  - Endorheic reaches are kept and flagged, and a map filter can hide them (Phase 2).
  - Intermittent streams are kept. They are labeled from GIRES v1.0 (modeled; caveat in the UI like HydroATLAS), and reaches without a GIRES prediction stay null.
  - Global FileGDBs (RiverATLAS, GIRES) are deleted after the basin subset is cached.
- **Phase 2 decisions (2026-09-30):**
  - Imagery: EOxCloudless 2024 (CC BY-NC-SA 4.0), so the site stays non-commercial. Its attribution is always visible on the map. EOX states no usage limits for the free tile service; ask before a public launch.
  - PMTiles are committed in `public/tiles/` (rivers 695 KB, mask 4.6 MB), and the dev server answers Range requests with 206.
  - tippecanoe v2.82.0 is built locally into `~/.local` (no sudo; see `pipeline/README.md`).
  - Visible Land buffers scale with Strahler order (`pipeline/map.config.json`). The six levels show 4.6%, 9%, 17%, 33%, 57% and 100% of the basin (`data/work/mask/report.json`).
  - The endorheic filter hides lines **and** their land. This revises the earlier "lines only" choice on 2026-09-30. Instead of a second set of masks, an `endorheic` overlay layer stores the land visible only because of endorheic drainage, per level. At the "whole basin" level that is the endorheic part of the basin itself (HydroBASINS `ENDO` ≠ 0). The overlay is drawn in the mask colour when the filter is on, and endorheic lake outlines hide too.
  - Lakes: HydroLAKES v1.0 (CC BY 4.0). River lines are removed inside all 245 basin lakes, except that 5 Limay reservoirs keep the Limay line (`pipeline/lakes.json`): Ezequiel Ramos Mexía, Piedra del Águila, Alicurá, Arroyito and Pichi Picún Leufú. Los Barreales and Mari Menuco have no named river through them, so all their lines are removed. Lakes are visible at every mask level and have a thin outline. GRanD itself is not used because its terms are unverified.
  - Locale prefixes dropped (reverses the Phase 0 `/en`, `/es` routes). A prefixed root layout remounted the whole tree on a language switch, rebuilding the map. Now the switcher sets the cookie and calls `router.refresh()`, so the map, the slider and the URL are kept. Old `/en/…` and `/es/…` links are redirected by `proxy.ts`, which sets the cookie. Pages now render per request because they read cookies and headers.

- **Phase 3 decisions (2026-09-30):**
  - Mongo stays: it serves search plus 8,016 reach documents for the unnamed-stream panel, which is more than a static JSON should ship to the browser. Collections `rivers` (15, `_id` = slug) and `reaches` (`_id` = HYRIV_ID).
  - `npm run seed` (`scripts/seed.ts`) validates `data/out/*.ndjson` against strict zod schemas (`lib/data/schemas.ts`), upserts whole documents by `_id`, deletes documents no longer in the files, and writes `data/work/seed/report.json`. A second run reports 0 upserted, 0 modified. It uses the app's `MONGODB_URI` for now; a separate read-only app user is a Phase 8 task.
  - Panel metrics come from RiverATLAS upstream attributes at the mouth reach (`inu_pc_umn/umx`, `lka_pc_use`, `pop_ct_usu`) and `dor_pc_pva` at the mouth; units are from the catalog (sheets H03, H04, H07, A01). Rule 4 in CLAUDE.md now names each value's period.
  - Rivers and reaches carry a `bbox` from HydroRIVERS geometry, so search results and shared links can fit the map without loaded tiles.
  - Clicking a line selects its named river; an unnamed reach opens a reach panel. Empty map or Escape clears.
  - URL: `?r=<slug>` or `?reach=<HYRIV_ID>`, kept with `history.replaceState` (no history entry per click).
  - API responses send `Cache-Control: public, max-age=300, s-maxage=86400, stale-while-revalidate=604800` (checked on `next start`). Search matches the start of any word, ignoring accents and case.

- **Phase 4 decisions (2026-10-01):**
  - Río Negro is the whole basin, not the stretch below the confluence. It is the root of the hierarchy (`level 0`); Limay, Neuquén and the endorheic areas are its children (`level 1`, `parentId: "negro"`). Its own area, the land that drains straight to the Río Negro, is drawn in a third colour and opens the whole-basin panel.
  - A river sub-basin is everything upstream (HydroBASINS level 12 `NEXT_DOWN`) of the polygon holding its river's mouth reach (`pipeline/subbasins.config.json`), minus endorheic polygons (`ENDO > 0`).
  - Endorheic land is its own node (`kind: "endorheic"`, no name, river or outlet; labelled per locale), not part of any river sub-basin, even where HydroBASINS links it virtually. Revised the same day: at first it followed the virtual links, which put a 9,365 km² endorheic area north of the confluence into the Río Negro. It hides with the endorheic filter.
  - The own areas partition the basin: Limay 59,868 km², Neuquén 34,536 km², Río Negro direct drainage 18,637 km², endorheic 23,163 km² (17 parts); sum = basin, 0 km² overlap and gap (`data/work/subbasins/report.json`). River sub-basins match their mouth's `UP_AREA` within 0.1%. Every endorheic reach lies in an endorheic polygon and no connected reach does. 6 invalid level-12 polygons are repaired with `ST_MakeValid`.
  - Reaches are assigned by their `HYBAS_L12` attribute. The connected reaches of each sub-basin equal the HydroRIVERS upstream set of its mouth reach (0 mismatches), and every reach midpoint lies in its owner's polygon.
  - Sub-basin metrics sum or `CATCH_SKM`-weight the RiverATLAS catchment attributes (`pop_ct_csu`, `lka_pc_cse`, `inu_pc_cmn/cmx`, `ele_mt_cmn/cmx`) over the node's land. For the whole basin that includes endorheic areas, so it exceeds the river panel's upstream values (population 765,417 vs 600,371). Units are confirmed by the report: over connected reaches they reproduce the mouth's upstream values (population within 0.01%). Discharge and dam regulation are taken at the mouth reach.
  - `public/tiles/subbasins.pmtiles` (151 KB) is built with `--detect-shared-borders`. Colours sit under the Visible Land mask; borders are drawn above it. The view mode is not in the URL on its own; `?s=` implies the sub-basin view.

## Repo layout

```
/app                 pages, /api/rivers/[id], /api/reaches/[id], /api/subbasins/[id], /api/search
/components          map/, panel/ (River, Reach, Subbasin, Info), SearchBox, UrlSync, Controls, ViewModeToggle, SubbasinLegend, LocaleSwitcher
/lib                 mongo.ts, data/ (schemas, queries), map/, store.ts, url-state.ts, units.ts
/messages            en.json, es.json
/pipeline            TS steps + README.md + SOURCES.md
/data                raw/ work/ (gitignored) · out/ (tiles, NDJSON)
/scripts             seed.ts
CLAUDE.md  PLAN.md
.claude/             agents/ and skills/ (committed)
```

## Phase 0 — Setup & decisions

- [x] `create-next-app` (TS strict, Tailwind, ESLint), Prettier, `npm run check`
- [x] next-intl wired with `/en` and `/es`, locale switcher, one translated string as a smoke test
- [~] Atlas M0 cluster, Vercel project, env vars (`MONGODB_URI`, imagery URL) — Atlas cluster live and seeded (2026-09-30); Vercel pending
- [x] Decide: imagery provider, PMTiles hosting
- [x] `pipeline/SOURCES.md` started (HydroSHEDS/HydroATLAS, IGN, OSM, imagery): license + citation for each
- [x] Playwright set up with one smoke screenshot
- [x] `.claude/agents/`: `data-inspector`, `pipeline-runner`, `license-checker`; skill `inspect-dataset` (verify frontmatter fields in the Claude Code docs first)
- **Done when:** repo runs, `npm run check` passes, empty deploy is live in both locales.

## Phase 1 — Pipeline v1 (HydroRIVERS / HydroATLAS / HydroBASINS only) ✅

- [x] Download South America HydroRIVERS, RiverATLAS, HydroBASINS into `data/raw/` with checksums
- [x] Delineate the basin: traverse HydroBASINS upstream from the Río Negro mouth via `NEXT_DOWN`, dissolve
- [x] Clip river reaches to the basin and join RiverATLAS attributes
- [x] Build "named rivers": trace main stem upstream from each confluence choosing the branch with the largest upstream area; aggregate length, source/mouth elevation, discharge at outlet
- [x] Manual `names.json` for the ~10 largest rivers (HydroRIVERS has no names)
- [x] Outputs: NDJSON for Mongo, GeoJSON for tiles, `report.json`
- **Done when:** report shows counts, total km, zero orphan reaches, and basin area within a sanity range against an official figure we agree on.

## Phase 2 — Base map ✅

- [x] MapLibre + imagery + PMTiles rivers (tippecanoe `minzoom` by Strahler order so small rivers appear on zoom)
- [x] Basin mask + Visible Land slider
- [x] Dark/light toggle, zoom controls, scale bar
- **Done when:** basin silhouette renders, small rivers appear progressively, slider is smooth.

## Phase 3 — Mongo & river panel ✅

- [x] `seed.ts` idempotent (bulk upsert); indexes (unique slug, text on names)
- [x] `/api/rivers/[id]` and `/api/search` with `Cache-Control` for CDN caching (plus `/api/reaches/[id]`)
- [x] River panel (length, distance to sea, source/mouth elevation, gradient, Strahler order, discharge, flooded %, lakes %, population, dam regulation %) with the modeled-data caveat in both languages
- [x] Search box; shareable URL state
- **Done when:** clicking a river opens real data; the link reproduces the state.

## Phase 4 — Sub-basins level 1 (Limay, Neuquén, Río Negro) ✅

- [x] Dissolve HydroBASINS polygons by main tributary; assign reaches (by `HYBAS_L12`, point-in-polygon as a cross-check)
- [x] Aggregate metrics into `subbasins` collection
- [x] Color layer, "basin / sub-basins" toggle, sub-basin panel, `?s=`
- **Done when:** areas sum to the basin with no overlaps or gaps (automatic check in the report).

## Gate — measure IGN data (before Phase 5)

- [x] Run the DuckDB comparison (IGN perennial streams vs HydroRIVERS in the basin bbox): total km, % with names (`npm run pipeline:ign-gate`, `data/work/ign-gate/report.json`)
- [x] Decide what IGN contributes: real extra detail, or mostly names

**Gate decisions (2026-10-01):**

- IGN line layers ("Corriente de agua perenne" and "intermitente", Shapefile) were downloaded on 2026-10-01 into `data/raw/ign/`. IGN's terms are custom, not CC BY (see `pipeline/SOURCES.md`): credit "FUENTE: Instituto Geográfico Nacional de la República Argentina", the date of the original data, and no endorsement claim.
- Perennial lines in the basin: 10,556 features, 13,635 km (HydroRIVERS: 8,016 reaches, 35,083 km), 84% of the km named, 494 distinct names. Lengths agree on the main rivers (Río Negro 723.7 km IGN vs 710.7 km HydroRIVERS; Limay 548.1 vs 555.3).
- Extra detail is marginal: IGN perennial km beyond 100 / 250 / 500 m of any HydroRIVERS reach is 56.5% / 26.2% / 16.8% of IGN km, adding 22% / 10.2% / 6.5% over HydroRIVERS. The rule (≥ 20% and ≥ 10%, at 250 m) passes only narrowly and fails at 500 m. HydroRIVERS comes from a coarse grid, so part of this is positional offset, not missing streams.
- Names are the main gain: up to 5,815 km (18.4%) of the 31,572 km of HydroRIVERS with no river name lies within 250 m of a named perennial IGN line (6,511 km, 20.6%, at 500 m). This is a proximity upper bound; the real figure comes from the Phase 5 match.
- Intermittent lines: 63,685 features, 77,682 km in the basin, 5.7% of the km named; 75% of the km is beyond 250 m of HydroRIVERS. Large, mostly unnamed geometry.
- **Scope chosen (owner, 2026-10-01): names + perennial detail layer.** Phase 5 keeps the match with confidence scores, the names, and a detail layer of unmatched perennial lines. **The intermittent layer is out of scope** (tile size and the committed PMTiles in `/public`, and almost no names); revisit only with a size and cost check. Because of the positional offset, "unmatched" must be judged with a buffer of at least 250 m plus overlap, not by distance alone.
- Caveats: distances are in Albers, so approximate; only exact duplicate lines were removed (overlap 0.1% for perennial, not measured for intermittent); no combined perennial + intermittent coverage was computed.

## Phase 5 — IGN integration

- [ ] Read IGN watercourses via DuckDB (GeoParquet mirror or official WFS/Shapefiles)
- [ ] Match IGN lines to HydroRIVERS reaches (buffer + overlap score); store best match with a confidence score
- [ ] Unmatched lines become a detail layer (name and length only, no hydrology metrics)
- [ ] Names from `FNA`/`NAM`; add lakes/reservoirs, dam walls, provincial boundaries
- [ ] Report: % matched, % named, low-confidence cases file for manual review
- **Done when:** report exists and low-confidence cases are triaged.

## Phase 6 — Finer sub-basins & hierarchy

- [ ] Levels 2 and 3 with `parentId`; breadcrumb navigation (Río Negro > Limay > Collón Curá)
- [ ] Metrics accumulate upward; tree selector
- **Done when:** any sub-basin can be selected from the map or the tree with consistent metrics.

## Phase 7 — Extras

- [ ] km/mi toggle, minimap, snapshot export, localities layer, mobile bottom-sheet panel

## Phase 8 — Release

- [ ] Attributions page (EN/ES) and modeled-data warnings
- [ ] OG image, performance pass, accessibility pass
- [ ] Atlas: read-only user, network access review for Vercel

## Open decisions

- Imagery provider and license
- PMTiles hosting (`/public` vs object storage)
- Official basin area figure for validation
- Exact sub-basin list per level (validate against AIC/official cartography)

## Risks

- IGN↔HydroRIVERS matching in braided or flat reaches
- Sub-basin boundaries in transition zones and endorheic areas
- Imagery license for a public site
- Mask/buffer polygon performance with complex geometry
- Modeled 1971–2000 hydrology vs a heavily regulated basin (El Chocón, Piedra del Águila, Alicurá, etc.)
