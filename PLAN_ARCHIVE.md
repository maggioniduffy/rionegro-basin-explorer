# PLAN_ARCHIVE.md — completed phases

Completed phases and items moved out of [PLAN.md](PLAN.md) so it stays short. Read this only
when you need the history of a finished phase; the dated decisions are in
[DECISSIONS.md](DECISSIONS.md). Items still open in Phases 7, 8 and Design v3 stay in PLAN.md.

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

## Phase 7 — Extras (done items; the Ask box is still open in PLAN.md)

- [x] km/mi toggle (panels and scale bar)
- [x] Minimap (top of the Display panel; desktop only)
- [x] Snapshot export (PNG with the attribution strip)
- [x] Localities layer: OSM city/town/village dots (116 in the basin), name on hover and in the panel on click, own Display toggle; no population (`pipeline:localities`)
- [x] Mobile bottom-sheet panel (Map · Details · Display tabs); still needs a check on a real phone
- [x] Hide/show: lakes (natural/artificial), rivers, and perennial vs non-perennial streams (GIRES `nonPerennial1d`); "arroyos" dropped (owner, 2026-10-02)
- [x] Layout: the new Phase 7 panel (localities, km/mi, …) sits at the bottom right; while it is open, the right column splits in two vertical halves (river/basin panel on top, new panel below), each scrolling on its own. Both columns keep the shared top edge (`--panel-top`)
- [x] Minimap follows the view: zooms in when the main map is close in, backs off when it is zoomed out past the basin
- [x] Land hidden by the Visible Land mask shows dimmed (translucent mask) instead of disappearing; outside the basin stays opaque

Decisions: [DECISSIONS.md](DECISSIONS.md#phase-7-2026-10-02).

## Phase 8 — Release (done items; the Atlas item is still open in PLAN.md)

- [x] Attributions page (EN/ES) and modeled-data warnings (`/attributions`, linked from the header and the panel caveats)
- [x] OG image, performance pass, accessibility pass (see DECISSIONS.md Phase 8; not checked in a browser)

## Design v3 — Landing and restyle (done items; `basin.png` is still open in PLAN.md)

- [x] Tokens, fonts and the theme cookie; WCAG AA checked by a test
- [x] Landing at `/` (header, hero, map card, feature cards, data note, footer); map moved to `/map`, old links redirect
- [x] Sample values sourced from `data/out` (`npm run landing:sample`)
- [x] Map app restyled: header, glass panels, rows, breadcrumb and child chips, view toggle, Visible Land slider; attributions page
- [x] Lighthouse a11y 1.0 and performance ≥ 0.9 on the landing (local build)
- [x] Restyled panels checked with live data (2026-10-06, after the read-only user was fixed)

Decisions: [DECISSIONS.md](DECISSIONS.md#design-v3-landing-and-app-restyle-2026-10-06).

## IGN streams — same-name reaches as one stream

- [x] `pipeline:ign-streams`: split each IGN name into connected streams (gap ≤ 2 unnamed reaches, absorbed under the stream's name), report with N = 0/1/2 and ambiguous cases
- [x] Export, tiles, seed, API, search, panel and URL use streams instead of `ign-names`; a click on a stream reach opens the whole stream
- [x] Run `pipeline:ign-streams` → `export` → `tiles` → `seed` on the real data and read the reports (2026-10-09, locally: 467 streams, all checks true, Atlas seeded)
- [x] **Owner:** review the 15 same-name sibling-branch cases listed in `data/work/ign-streams/report.json` (2026-10-09: kept as separate streams; repeated names are common)
- [x] Rivers and streams end where their IGN name ends (owner: IGN wins any dispute): approved rivers start at their lake outlet, streams keep only reaches the IGN line runs along (coverage ≥ 0.5); Currhué, Negro, Malleo and Collón Curá overrides; pipeline order now `ign-match` → `named`; Atlas re-seeded

Decisions: [DECISSIONS.md](DECISSIONS.md#ign-streams-2026-10-09).
