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
- **Dated decisions** (what was chosen in each phase, with figures and reasons) are in [DECISSIONS.md](DECISSIONS.md).

## Repo layout

```
/app/[region]        pages, /api/rivers/[id], /api/reaches/[id], /api/subbasins/[id], /api/search
/components          map/, panel/ (River, Reach, Subbasin, Info), SearchBox, UrlSync, Controls, ViewModeToggle, SubbasinLegend, LocaleSwitcher
/lib                 mongo.ts, data/ (schemas, queries), map/, store.ts, url-state.ts, units.ts
/regions             index.ts (known/served ids, DB names), hosts.ts, <id>/ (configs, messages/, content.ts, generated files)
/messages            shared en.json, es.json (region strings in regions/<id>/messages)
/pipeline            TS steps + README.md + SOURCES.md
/data                raw/ (shared) work/<region>/ (gitignored) · out/<region>/ (NDJSON)
/scripts             seed.ts
CLAUDE.md  PLAN.md  DECISSIONS.md
.claude/             agents/ and skills/ (committed)
```

## Phase 0 — Setup & decisions

- [x] `create-next-app` (TS strict, Tailwind, ESLint), Prettier, `npm run check`
- [x] next-intl wired with `/en` and `/es`, locale switcher, one translated string as a smoke test
- [x] Atlas M0 cluster, Vercel project, env vars (`MONGODB_URI`, imagery URL) — Atlas cluster live and seeded (2026-09-30); Vercel live at https://rionegrobasinexplorer.vercel.app/ (2026-10-01)
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

Results and the chosen scope (names + perennial detail layer; intermittent lines out of scope) are in [DECISSIONS.md](DECISSIONS.md#gate-ign-data-2026-10-01).

## Phase 5 — IGN integration ✅

- [x] Read IGN watercourses via DuckDB (`pipeline:ign`, Shapefile from `data/raw/ign/`)
- [x] Match IGN lines to HydroRIVERS reaches (buffer + coverage); store best match with a confidence tier (`pipeline:ign-match`)
- [x] Unmatched perennial lines become a detail layer (name and length only, no hydrology metrics)
- [x] Names from `fna` replace the OSM names of the approved rivers; IGN names are searchable; lake names and extra lakes, dam points and walls (`pipeline:ign-layers`). Provincial boundaries dropped (owner)
- [x] Report: % matched, % named, low-confidence cases file for manual review (`data/work/ign-match/`)
- [x] Low-confidence cases triaged: 180 of 228 accepted in bulk (owner will review later), 48 stay hidden
- [x] `npm run seed` re-run on Atlas (reaches with `ign`, `ignNames`, river names)
- **Done when:** report exists and low-confidence cases are triaged.

Decisions, figures and open points: [DECISSIONS.md](DECISSIONS.md#phase-5-2026-10-01).

## Phase 6 — Finer sub-basins & hierarchy

- [x] Levels 2–4 with `parentId` (21 approved tributaries, 25 nodes; level 4 added for the Aluminé's tributaries); breadcrumb navigation (Río Negro > Limay > Collón Curá)
- [x] Metrics accumulate upward (report checks child ≤ parent); tree selector in Controls
- [x] Node list checked against AIC/SSRH: the nesting is hydrological (owner: kept, option A), not the AIC's flat list; the 9 missing AIC subcuencas were added
- [x] `npm run seed` on Atlas (2026-10-02: 24 rivers and 25 sub-basins, all seed checks true)
- **Done when:** any sub-basin can be selected from the map or the tree with consistent metrics.

Decisions, figures and the AIC comparison: [DECISSIONS.md](DECISSIONS.md#phase-6-2026-10-02).

## Phase 7 — Extras

- [x] km/mi toggle (panels and scale bar)
- [x] Minimap (top of the Display panel; desktop only)
- [x] Snapshot export (PNG with the attribution strip)
- [x] Localities layer: OSM city/town/village dots (116 in the basin), name on hover and in the panel on click, own Display toggle; no population (`pipeline:localities`)
- [x] Mobile bottom-sheet panel (Map · Details · Display tabs); still needs a check on a real phone
- [x] Hide/show: lakes (natural/artificial), rivers, and perennial vs non-perennial streams (GIRES `nonPerennial1d`); "arroyos" dropped (owner, 2026-10-02)
- [x] Layout: the new Phase 7 panel (localities, km/mi, …) sits at the bottom right; while it is open, the right column splits in two vertical halves (river/basin panel on top, new panel below), each scrolling on its own. Both columns keep the shared top edge (`--panel-top`)
- [x] Minimap follows the view: zooms in when the main map is close in, backs off when it is zoomed out past the basin
- [x] Land hidden by the Visible Land mask shows dimmed (translucent mask) instead of disappearing; outside the basin stays opaque

- [~] **Ask box (EN/ES):** a typed question resolves to a map action (select a river or sub-basin, or search). Fuzzy name match first (Fuse.js over an in-memory catalog, no LLM); otherwise one LLM call (Groq by default, `lib/llm.ts`) that may only return a catalog id, validated with Zod. `/api/ask` with a two-tier cache and a per-IP rate limit (Upstash Redis free tier). one bar for names and questions; comparisons, rankings and single values answered in a card under the bar from Mongo values (v2, 2026-10-10)
  - Code, tests and docs done (2026-10-10): 305 unit/route tests and `e2e/ask.spec.ts` (3 tests, fuzzy path) pass. Left for the owner: create the Upstash database and Groq key (check Upstash overage terms, Groq's training clause and free limits, turn on Zero Data Retention), set the env on Vercel, and try a few sentence questions live
  - **Done when:** fuzzy search resolves typo/accent variants without calling the LLM; sentence-style queries ("show me the biggest tributary of the Limay") resolve to a valid slug or `unsupported`; an invented slug from the LLM can never reach the client; rate limit and cache verified by tests; `npm run check` and `npm run test:e2e` pass; all new strings exist in both locales.

Decisions: [DECISSIONS.md](DECISSIONS.md#phase-7-2026-10-02).
Ask box: [DECISSIONS.md](DECISSIONS.md#phase-7-ask-box-2026-10-10).

## Phase 8 — Release

- [x] Attributions page (EN/ES) and modeled-data warnings (`/attributions`, linked from the header and the panel caveats)
- [x] OG image, performance pass, accessibility pass (see DECISSIONS.md Phase 8; not checked in a browser)
- [ ] Atlas: read-only user, network access review for Vercel (code and review done; the read-only user authenticates and `npm run atlas:check` passes locally (2026-10-06); left: set it on Vercel)

## Design v3 — Landing and restyle (DESIGN.md)

- [x] Tokens, fonts and the theme cookie; WCAG AA checked by a test
- [x] Landing at `/` (header, hero, map card, feature cards, data note, footer); map moved to `/map`, old links redirect
- [x] Sample values sourced from `data/out` (`npm run landing:sample`)
- [x] Map app restyled: header, glass panels, rows, breadcrumb and child chips, view toggle, Visible Land slider; attributions page
- [x] Lighthouse a11y 1.0 and performance ≥ 0.9 on the landing (local build)
- [ ] Regenerate `basin.png` (`public/landing/nqn/basin.png`) from the real map before release
- [x] Restyled panels checked with live data (2026-10-06, after the read-only user was fixed)

Decisions: [DECISSIONS.md](DECISSIONS.md#design-v3-landing-and-app-restyle-2026-10-06).

## IGN streams — same-name reaches as one stream

- [x] `pipeline:ign-streams`: split each IGN name into connected streams (gap ≤ 2 unnamed reaches, absorbed under the stream's name), report with N = 0/1/2 and ambiguous cases
- [x] Export, tiles, seed, API, search, panel and URL use streams instead of `ign-names`; a click on a stream reach opens the whole stream
- [x] Run `pipeline:ign-streams` → `export` → `tiles` → `seed` on the real data and read the reports (2026-10-09, locally: 467 streams, all checks true, Atlas seeded)
- [x] **Owner:** review the 15 same-name sibling-branch cases listed in `data/work/ign-streams/report.json` (2026-10-09: kept as separate streams; repeated names are common)
- [x] Rivers and streams end where their IGN name ends (owner: IGN wins any dispute): approved rivers start at their lake outlet, streams keep only reaches the IGN line runs along (coverage ≥ 0.5); Currhué, Negro, Malleo and Collón Curá overrides; pipeline order now `ign-match` → `named`; Atlas re-seeded

Decisions: [DECISSIONS.md](DECISSIONS.md#ign-streams-2026-10-09).

## Multi-region — sub-apps per region (Río Negro = `nqn`, Córdoba = `cba`)

One Next.js app serves every region (Option A, owner 2026-10-10); a region is a config folder, not a fork.
Decisions: [DECISSIONS.md](DECISSIONS.md#multi-region-2026-10-10). Steps to run locally after each change: [RUN_LOCAL.md](RUN_LOCAL.md).

### Phase R0 — Decisions & inputs

- [x] Option A (one app, region registry), subdomains, `nqn` = the current Río Negro basin, Córdoba = province + the interprovincial basins that reach it, endorheic basins split (one root per sink)
- [x] Domain for subdomains: on Vercel, which kind of domain deferred (owner, 2026-10-10); R1 maps any host to a region through a config table, so the choice needs no code change
- [x] Córdoba scope rule: R2 lists the candidate basins with their areas inside/outside the province, then the owner picks which are whole and which are clipped (e.g. the Salí-Dulce reaches Mar Chiquita from Tucumán)
- [ ] Córdoba provincial layers (ArcGIS Experience "Cuencas y Unidades de Gestión"): owner exports or allows `arcgis.com` in the environment; license-checker before use; the shared link is a `draft=true` view, confirm the published one
- **Done when:** the open items above are decided and recorded in DECISSIONS.md. The ArcGIS item blocks R2's comparison only, not R1.

### Phase R1 — Region refactor, no behavior change

Code and docs done in the cloud (2026-10-10, steps 1–8); waiting on the local checks in [RUN_LOCAL.md](RUN_LOCAL.md) before it counts as done.

- [x] `regions/<id>/`: pipeline configs (basin, map, subbasins, names, lakes, ign-overrides), `region.ts` (title keys, featured rivers, OG text, LLM few-shot examples, data caveats such as the regulated-rivers text), messages (`region.*` namespace) — configs moved to `regions/nqn/` with the registry `regions/index.ts` (step 1, 2026-10-10)
- [x] Pipeline steps take `--region`; `data/work/<region>/`, `data/out/<region>/`; `data/raw/` and checksums stay shared (step 2, 2026-10-10; default `nqn`)
- [x] Tiles in `public/tiles/<region>/`; `TILE_PATHS` and `mapConfig` resolved from the region — tiles moved and versioned per region (step 3); the map and minimap read `tilePaths(region)` and `mapConfigFor(region)` from the region provider (step 5c, 2026-10-10)
- [x] Mongo: one database per region on the same cluster, `getDb(region)`; seed and `atlas:check` take `--region` (step 4, 2026-10-10; routes pass the default region until step 5)
- [x] Routes and the ask catalog, LLM cache key and rate limit read the request's region — queries, catalog (one per region) and cache key take it (step 5a, 2026-10-10); the routes read it from `app/[region]` since 5b. The rate limit stays per IP across regions (one LLM quota)
- [x] `proxy.ts` maps host → region (rewrite to `/[region]/…`); local dev via `<region>.localhost`; old `rionegrobasinexplorer.vercel.app` URLs keep working as `nqn` (step 5b, 2026-10-10)
- [x] Río Negro-specific strings and code (landing, `MapAccessCard`, OG image, icon, LLM prompt examples) move into `regions/nqn/` — strings (step 6a: `regions/nqn/messages/`) and content (step 6b: `regions/nqn/content.ts`, landing sample, OG shapes, landing image), 2026-10-10. The icon (Limay and Neuquén converging) stays the shared app logo
- [x] Stub `cba` region: accepted by `--region` (`KNOWN_REGION_IDS`), its own database name, not served (`cba.<host>` → 404); `regions/cba/README.md` lists what serving it needs (step 7, 2026-10-10)
- [x] `--region` required on every pipeline step and data script (owner, 2026-10-10)
- **Done when:** `npm run check` passes; re-running the pipeline for `nqn` reproduces the committed `data/out` and reports unchanged; the live `nqn` site behaves as before; a stub `cba` region builds. Cloud checks are done; the local ones (pipeline re-run, browser, e2e, Vercel) are in [RUN_LOCAL.md](RUN_LOCAL.md).

### Pending for Rio Negro but for Cordoba too

- [ ] Add some opacity to the sub-basin selected, and quit some opacity and width to the lines that divides basins.

### Phase R2 — Córdoba gate

- [ ] Delineate candidate basins touching the province from HydroBASINS (sea/river outlets and endorheic sinks: Mar Chiquita, Salinas Grandes, Bañados del Quinto, …), report areas inside/outside the province
- [ ] IGN gate for Córdoba (HydroRIVERS vs IGN km and % named); Sierras streams are short and steep, so 15″ HydroRIVERS may be too coarse
- [ ] Compare with the provincial "Cuencas y Unidades de Gestión" layer (if licensed)
- **Done when:** the owner picks the basin list and IGN's role from the report.

### Phase R3 — Córdoba pipeline & app (Phases 1–6 reused)

- [ ] Basin step supports several roots: river outlets and endorheic sinks, each its own top-level node (no grouped endorheic node)
- [ ] Rivers that end in wetlands or sinks: the "mouth" is the terminal reach, flagged; no sea distance
- [ ] Names, IGN match/streams, sub-basins, localities, tiles, seed for `cba`; caveats name Córdoba's dams (San Roque, Los Molinos, Río Tercero, …)
- **Done when:** the same report checks as Río Negro pass for every root (partition, no orphans, child ≤ parent).

### Phase R4 — Hub

- [ ] Hub landing listing the regions; each region's landing links back

## Open decisions

- PMTiles hosting (`/public` vs object storage)
- Official basin area figure for validation
- Exact sub-basin list per level: every AIC subcuenca is now a node, nested hydrologically rather than flat (see DECISSIONS.md Phase 6)

## Risks

- IGN↔HydroRIVERS matching in braided or flat reaches
- Sub-basin boundaries in transition zones and endorheic areas
- Imagery license for a public site
- Mask/buffer polygon performance with complex geometry
- Modeled 1971–2000 hydrology vs a heavily regulated basin (El Chocón, Piedra del Águila, Alicurá, etc.)
