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
CLAUDE.md  context/ (PLAN.md  PLAN_ARCHIVE.md  DECISSIONS.md  RUN_LOCAL.md  PENDING.md  DESIGN.md)
.claude/             agents/ and skills/ (committed)
```

## Archived phases

Phases 0–6, the IGN gate, IGN streams, and the done items of Phases 7, 8 and Design v3 are in
[PLAN_ARCHIVE.md](PLAN_ARCHIVE.md). Read it only when you need the history of a finished phase.

## Open items from earlier phases

### Phase 7 — Extras

- [~] **Ask box (EN/ES):** a typed question resolves to a map action (select a river or sub-basin, or search). Fuzzy name match first (Fuse.js over an in-memory catalog, no LLM); otherwise one LLM call (Groq by default, `lib/llm.ts`) that may only return a catalog id, validated with Zod. `/api/ask` with a two-tier cache and a per-IP rate limit (Upstash Redis free tier). one bar for names and questions; comparisons, rankings and single values answered in a card under the bar from Mongo values (v2, 2026-10-10)
  - Code, tests and docs done (2026-10-10): 305 unit/route tests and `e2e/ask.spec.ts` (3 tests, fuzzy path) pass. Left for the owner: create the Upstash database and Groq key (check Upstash overage terms, Groq's training clause and free limits, turn on Zero Data Retention), set the env on Vercel, and try a few sentence questions live
  - **Done when:** fuzzy search resolves typo/accent variants without calling the LLM; sentence-style queries ("show me the biggest tributary of the Limay") resolve to a valid slug or `unsupported`; an invented slug from the LLM can never reach the client; rate limit and cache verified by tests; `npm run check` and `npm run test:e2e` pass; all new strings exist in both locales.

Ask box: [DECISSIONS.md](DECISSIONS.md#phase-7-ask-box-2026-10-10).

### Phase 8 — Release

- [ ] Atlas: read-only user, network access review for Vercel (code and review done; the read-only user authenticates and `npm run atlas:check` passes locally (2026-10-06); left: set it on Vercel)

### Design v3 — Landing and restyle (DESIGN.md)

- [ ] Regenerate `basin.png` (`public/landing/nqn/basin.png`) from the real map before release

### Design v6 — Landing v6 and restyle

Decisions: [DECISSIONS.md](DECISSIONS.md#design-v6--landing-and-restyle-2026-10-13).

- [x] Tokens: light = the v6 palette, dark = a derived navy; new `--cta`, `--note-*`, `--dot`, `--hero-shadow`; Instrument Serif replaces Figtree (`npm run check` passes)
- [x] Landing for both regions: header, hero with the image link, sources row (per region), explore columns, data note, footer with the river-valley art; `HeroRivers` and the mock panels removed
- [x] Hub in the same style (header, eyebrow, serif title, rounded region cards, grain)
- [x] Map app: serif panel titles, mono values, pill locale switcher
- [ ] Regenerate e2e screenshot baselines and review both regions in a browser (EN/ES, light/dark, 1440/390px)

## Multi-region — sub-apps per region (Río Negro = `nqn`, Córdoba = `cba`)

One Next.js app serves every region (Option A, owner 2026-10-10); a region is a config folder, not a fork.
Decisions: [DECISSIONS.md](DECISSIONS.md#multi-region-2026-10-10). Steps to run locally after each change: [RUN_LOCAL.md](RUN_LOCAL.md).

### Phase R0 — Decisions & inputs ✅

- [x] Option A (one app, region registry), subdomains, `nqn` = the current Río Negro basin, Córdoba = province + the interprovincial basins that reach it, endorheic basins split (one root per sink)
- [x] Domain for subdomains: on Vercel, which kind of domain deferred (owner, 2026-10-10); R1 maps any host to a region through a config table, so the choice needs no code change
- [x] Córdoba scope rule: R2 lists the candidate basins with their areas inside/outside the province, then the owner picks which are whole and which are clipped (e.g. the Salí-Dulce reaches Mar Chiquita from Tucumán)
- [x] Córdoba provincial layers (ArcGIS Experience "Cuencas y Unidades de Gestión"): owner exported ten APRHI layers to `data/raw/`; license read (PIHC terms, IGN-like, usable); published Experience confirmed (2026-10-11). Open: source URL of three layers (possible student copies), see SOURCES.md
- [x] Province boundary: IGN "Provincia" layer in `data/raw/ign/provincia/` (2026-10-12)
- **Done when:** the open items above are decided and recorded in DECISSIONS.md. The ArcGIS item blocks R2's comparison only, not R1.

### Phase R1 — Region refactor, no behavior change ✅

Code and docs done in the cloud (2026-10-10, steps 1–8). Local checks passed (2026-10-11): the `nqn` pipeline re-run reproduces `data/out` and the reports, `npm run check` passes, the API answers per host. Left for the owner: browser, e2e and Vercel checks in [RUN_LOCAL.md](RUN_LOCAL.md).

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

### Phase R2 — Córdoba gate ✅

- [x] Delineate candidate basins touching the province from HydroBASINS (sea/river outlets and endorheic sinks: Mar Chiquita, Salinas Grandes, Bañados del Quinto, …), report areas inside/outside the province — `pipeline:basin-gate`, matched to APRHI's six interprovincial basins (2026-10-12)
- [x] IGN gate for Córdoba (HydroRIVERS vs IGN km and % named); Sierras streams are short and steep, so 15″ HydroRIVERS may be too coarse — `pipeline:lines-gate`, with APRHI's lines as a third source (2026-10-12)
- [x] Compare with the provincial "Cuencas y Unidades de Gestión" layer (licensed; APRHI's six interprovincial basins and their areas per province are in DECISSIONS.md R0)
- **Done when:** the owner picks the basin list and IGN's role from the report. Done 2026-10-12: precedence APRHI > IGN > HydroRIVERS; 01, 02, 03, 05 whole, 04 clipped plus the Río Quinto headwaters, 06 clipped ([DECISSIONS.md](DECISSIONS.md#córdoba-r2-gate-2026-10-12)).

### Phase R3 — Córdoba pipeline & app (Phases 1–6 reused)

Plan approved 2026-10-12 ([DECISSIONS.md](DECISSIONS.md#córdoba-r3-plan-2026-10-12)): precedence APRHI > IGN > HydroRIVERS, same app contract, HydroRIVERS as the hidden network.

- [x] R3.0 Inputs: re-download RiverATLAS and GIRES; delete them again (with their markers) after R3.2 caches the `cba` subsets — subsets cached in `data/work/cba/rivers/`, FileGDBs and markers deleted (2026-10-12)
- [x] R3.1 Region outline (APRHI polygons) and typed roots; Río Quinto headwaters from HydroBASINS — `pipeline:basin` reference mode, outline 291,118 km², headwaters 6,628 km² (2026-10-12)
- [x] R3.2 Hidden network: reaches per root, RiverATLAS/GIRES, `network-overrides.json` — cross-root edges cut; overrides need an APRHI line: Río Quinto main stem → 04, Río Cuarto → Saladillo → Carcarañá; southern arroyos stay endorheic in 03 (no APRHI link) (2026-10-12). Local preview: `npm run preview:map -- --region cba`
- [x] R3.3 Displayed lines: APRHI inside the province (no "Eliminado", "En revisión" flagged), IGN outside, each matched to a reach — `pipeline:lines`, 25,401 pieces, 44% of km matched (main rivers 62–84%), buffer 250 m / 1 km by Strahler order (2026-10-11). APRHI has no lines in 05 and 06 and 331 km in 04 (layer coverage; see [PENDING.md](PENDING.md)). Heavy steps cap DuckDB at 4 GB, `PIPELINE_MEMORY_LIMIT` raises it on a larger machine
- [x] R3.4 Rivers and streams from APRHI names (`names.json`), IGN names as aliases — `pipeline:line-names` (abbreviations expanded, starred names blank, spelling fixes only by owner approval, IGN aliases at ≥ 50%), 13 rivers in `regions/cba/names.json` (2,436 km; four main-stem `sourceReach` overrides), 704 streams; `named`/`ign-streams`/`export` pick the name source per region (`namesFrom`), `nqn` unchanged (2026-10-12). Export for `cba` runs in R3.8; stream search aliases wait for R3.7
- [x] R3.5 Sub-basins from APRHI: region → 6 basins → 25 subcuencas → 80 UGH — `pipeline:subbasins` reference mode, 112 nodes of kind `area` (schema), parent by geometry, stable ids in `regions/cba/subbasin-ids.json`, outlets by the 90% rule (5 basins, 1 subcuenca, 18 UGH), salar and lagoon in their basin's own area; `nqn` unchanged (2026-10-12)
- [x] R3.6 Lakes and dams: APRHI > IGN > HydroLAKES; caveat names Córdoba's dams — `pipeline:lakes` / `ign-layers` reference mode, 2,202 polygons (APRHI 1,630, IGN 96, HydroLAKES 476 incl. Salinas Grandes), Mar Chiquita from APRHI, lines cut inside water, 39 IGN dams; the dam caveat list (26 APRHI Presa reservoirs) is in DECISSIONS.md for the region text in R3.8; `nqn` unchanged (2026-10-12)
- [x] R3.7 App contract: sink and region-edge mouths, root per reach, line source and status (no change for `nqn`) — `mouthKind` on rivers, reaches and streams (4 rivers end at the region's edge, 9 in sinks), distance to the sea null in sinks and across override links (the Río Cuarto system), `root` and `lineReview` per reach, piece tiles with source/status/display order, unmatched pieces clickable (owner), lake `source`, area wording in panels, ask box and prompt; `nqn` data byte-identical (2026-10-12)
- [x] R3.8 Localities, mask, map config, tiles, export, seed `basin-explorer-cba`; the map style matches Río Negro's (same layers, colours and widths; owner, 2026-10-11) — export, localities (687 places), mask, tiles (~15 MB, owner approved) all ok; `cba` served at `cordobabasinexplorer.vercel.app` (dev `cordoba.localhost:3000`) and listed on the hub. Owner, local: seed `basin-explorer-cba` + Atlas grant, landing image, browser pass ([RUN_LOCAL.md](RUN_LOCAL.md)) (2026-10-12)

Original items:

- [ ] Basin step supports several roots: river outlets and endorheic sinks, each its own top-level node (no grouped endorheic node)
- [ ] Rivers that end in wetlands or sinks: the "mouth" is the terminal reach, flagged; no sea distance
- [ ] Names, IGN match/streams, sub-basins, localities, tiles, seed for `cba`; caveats name Córdoba's dams (San Roque, Los Molinos, Río Tercero, …)
- **Done when:** the same report checks as Río Negro pass for every root (partition, no orphans, child ≤ parent).

### Phase R4 — Hub

- [x] Hub landing listing the regions; each region's landing links back — `app/hub` on `basinexplorer.vercel.app` (dev `hub.localhost:3000`), regions at `rionegrobasinexplorer.vercel.app` and `cordobabasinexplorer.vercel.app` (Vercel refused nested names), back link where a hub exists (2026-10-12)

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
