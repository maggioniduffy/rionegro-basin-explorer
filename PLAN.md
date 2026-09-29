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
- **i18n:** next-intl, locale-prefixed routes (`/en`, `/es`), messages in `/messages`. Verify current next-intl version/API against the docs when installing. Proper nouns are not translated; units toggle km/mi independently of locale.
- **State:** Zustand synced to URL (`?r=<river>&s=<subbasin>&lang` via route).
- **Hosting/cost:** Vercel + Atlas M0. PMTiles in `/public` if small, otherwise object storage with HTTP Range support. Check limits and pricing for each before committing.

## Repo layout

```
/app                 pages, /api/rivers/[id], /api/subbasins/[id], /api/search
/components          Map, RiverPanel, SubbasinPanel, Controls, LocaleSwitcher
/lib                 mongo.ts, map/, store.ts, units.ts
/messages            en.json, es.json
/pipeline            TS steps + README.md + SOURCES.md
/data                raw/ work/ (gitignored) · out/ (tiles, NDJSON)
/scripts             seed.ts
CLAUDE.md  PLAN.md
```

## Phase 0 — Setup & decisions

- [ ] `create-next-app` (TS strict, Tailwind, ESLint), Prettier, `npm run check`
- [ ] next-intl wired with `/en` and `/es`, locale switcher, one translated string as a smoke test
- [ ] Atlas M0 cluster, Vercel project, env vars (`MONGODB_URI`, imagery URL)
- [ ] Decide: imagery provider, PMTiles hosting
- [ ] `pipeline/SOURCES.md` started (HydroSHEDS/HydroATLAS, IGN, OSM, imagery): license + citation for each
- [ ] Playwright set up with one smoke screenshot
- **Done when:** repo runs, `npm run check` passes, empty deploy is live in both locales.

## Phase 1 — Pipeline v1 (HydroRIVERS / HydroATLAS / HydroBASINS only)

- [ ] Download South America HydroRIVERS, RiverATLAS, HydroBASINS into `data/raw/` with checksums
- [ ] Delineate the basin: traverse HydroBASINS upstream from the Río Negro mouth via `NEXT_DOWN`, dissolve
- [ ] Clip river reaches to the basin and join RiverATLAS attributes
- [ ] Build "named rivers": trace main stem upstream from each confluence choosing the branch with the largest upstream area; aggregate length, source/mouth elevation, discharge at outlet
- [ ] Manual `names.json` for the ~10 largest rivers (HydroRIVERS has no names)
- [ ] Outputs: NDJSON for Mongo, GeoJSON for tiles, `report.json`
- **Done when:** report shows counts, total km, zero orphan reaches, and basin area within a sanity range against an official figure we agree on.

## Phase 2 — Base map

- [ ] MapLibre + imagery + PMTiles rivers (tippecanoe `minzoom` by Strahler order so small rivers appear on zoom)
- [ ] Basin mask + Visible Land slider
- [ ] Dark/light toggle, zoom controls, scale bar
- **Done when:** basin silhouette renders, small rivers appear progressively, slider is smooth.

## Phase 3 — Mongo & river panel

- [ ] `seed.ts` idempotent (bulk upsert); indexes (unique slug, text on names)
- [ ] `/api/rivers/[id]` and `/api/search` with `Cache-Control` for CDN caching
- [ ] River panel (length, distance to sea, source/mouth elevation, gradient, Strahler order, discharge, flooded %, lakes %, population, dam regulation %) with the modeled-data caveat in both languages
- [ ] Search box; shareable URL state
- **Done when:** clicking a river opens real data; the link reproduces the state.

## Phase 4 — Sub-basins level 1 (Limay, Neuquén, Río Negro)

- [ ] Dissolve HydroBASINS polygons by main tributary; assign reaches by point-in-polygon
- [ ] Aggregate metrics into `subbasins` collection
- [ ] Color layer, "basin / sub-basins" toggle, sub-basin panel, `?s=`
- **Done when:** areas sum to the basin with no overlaps or gaps (automatic check in the report).

## Gate — measure IGN data (before Phase 5)

- [ ] Run the DuckDB comparison (IGN perennial streams vs HydroRIVERS in the basin bbox): total km, % with names
- [ ] Decide what IGN contributes: real extra detail, or mostly names

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
- Whether Mongo stays or a static JSON is enough (revisit after Phase 3)

## Risks

- IGN↔HydroRIVERS matching in braided or flat reaches
- Sub-basin boundaries in transition zones and endorheic areas
- Imagery license for a public site
- Mask/buffer polygon performance with complex geometry
- Modeled 1971–2000 hydrology vs a heavily regulated basin (El Chocón, Piedra del Águila, Alicurá, etc.)
