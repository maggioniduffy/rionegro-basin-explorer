# DECISSIONS.md — Río Negro Basin Explorer

Dated decisions made while working through [PLAN.md](PLAN.md), with the figures and the reasons
behind them. When a choice revises an earlier one, the entry that changes it says so.
The standing architecture decisions stay in PLAN.md; data licenses are in `pipeline/SOURCES.md`.

## Phase 0 (2026-09-29)

- Imagery: undecided until Phase 2. EOX is recorded in `SOURCES.md` (CC BY-NC-SA, verified); Esri's terms are still unverified.
- PMTiles: `/public` for now, pending a Range-request check on Vercel and the actual size after Phase 1.
- Region: São Paulo for Atlas and Vercel, if the free Atlas tier (M0) is offered there.
- Deploy: GitHub repo + Vercel Git integration.
- CI: GitHub Actions runs `npm run check`. Playwright stays local until Phase 2.
- `/api/health` pings Mongo to prove the wiring.
- Dark theme is the default.

## Phase 1 (2026-09-30)

- Basin area shown in the app is the computed HydroBASINS polygon area, which includes the endorheic parts virtually linked to the basin: 136,204 km².
- AIC's 140,000 km² ("La Cuenca" page, a rounded figure) is only a sanity check, ±10%. The latest result is −2.7%.
- The surface-connected area (113,040 km², matching HydroBASINS `UP_AREA`) stays in the report as context.
- DuckDB comes from the npm package `@duckdb/node-api`.
- Only small outputs are committed (`report.json`, `rivers.ndjson`). `reaches.ndjson` and GeoJSON are regenerated locally.
- Raw data is not stored in the cloud; `pipeline/checksums.json` pins the inputs.
- Endorheic reaches are kept and flagged, and a map filter can hide them (Phase 2).
- Intermittent streams are kept. They are labeled from GIRES v1.0 (modeled; caveat in the UI like HydroATLAS), and reaches without a GIRES prediction stay null.
- Global FileGDBs (RiverATLAS, GIRES) are deleted after the basin subset is cached.

## Phase 2 (2026-09-30)

- Imagery: EOxCloudless 2024 (CC BY-NC-SA 4.0), so the site stays non-commercial. Its attribution is always visible on the map. EOX states no usage limits for the free tile service; ask before a public launch.
- PMTiles are committed in `public/tiles/` (rivers 695 KB, mask 4.6 MB), and the dev server answers Range requests with 206.
- tippecanoe v2.82.0 is built locally into `~/.local` (no sudo; see `pipeline/README.md`).
- Visible Land buffers scale with Strahler order (`pipeline/map.config.json`). The six levels show 4.6%, 9%, 17%, 33%, 57% and 100% of the basin (`data/work/mask/report.json`).
- The endorheic filter hides lines **and** their land. This revises the earlier "lines only" choice on 2026-09-30. Instead of a second set of masks, an `endorheic` overlay layer stores the land visible only because of endorheic drainage, per level. At the "whole basin" level that is the endorheic part of the basin itself (HydroBASINS `ENDO` ≠ 0). The overlay is drawn in the mask colour when the filter is on, and endorheic lake outlines hide too.
- Lakes: HydroLAKES v1.0 (CC BY 4.0). River lines are removed inside all 245 basin lakes, except that 5 Limay reservoirs keep the Limay line (`pipeline/lakes.json`): Ezequiel Ramos Mexía, Piedra del Águila, Alicurá, Arroyito and Pichi Picún Leufú. Los Barreales and Mari Menuco have no named river through them, so all their lines are removed. Lakes are visible at every mask level and have a thin outline. GRanD itself is not used because its terms are unverified.
- Locale prefixes dropped (reverses the Phase 0 `/en`, `/es` routes). A prefixed root layout remounted the whole tree on a language switch, rebuilding the map. Now the switcher sets the cookie and calls `router.refresh()`, so the map, the slider and the URL are kept. Old `/en/…` and `/es/…` links are redirected by `proxy.ts`, which sets the cookie. Pages now render per request because they read cookies and headers.

## Phase 3 (2026-09-30)

- Mongo stays: it serves search plus 8,016 reach documents for the unnamed-stream panel, which is more than a static JSON should ship to the browser. Collections `rivers` (15, `_id` = slug) and `reaches` (`_id` = HYRIV_ID).
- `npm run seed` (`scripts/seed.ts`) validates `data/out/*.ndjson` against strict zod schemas (`lib/data/schemas.ts`), upserts whole documents by `_id`, deletes documents no longer in the files, and writes `data/work/seed/report.json`. A second run reports 0 upserted, 0 modified. It uses the app's `MONGODB_URI` for now; a separate read-only app user is a Phase 8 task.
- Panel metrics come from RiverATLAS upstream attributes at the mouth reach (`inu_pc_umn/umx`, `lka_pc_use`, `pop_ct_usu`) and `dor_pc_pva` at the mouth; units are from the catalog (sheets H03, H04, H07, A01). Rule 4 in CLAUDE.md now names each value's period.
- Rivers and reaches carry a `bbox` from HydroRIVERS geometry, so search results and shared links can fit the map without loaded tiles.
- Clicking a line selects its named river; an unnamed reach opens a reach panel. Empty map or Escape clears.
- URL: `?r=<slug>` or `?reach=<HYRIV_ID>`, kept with `history.replaceState` (no history entry per click).
- API responses send `Cache-Control: public, max-age=300, s-maxage=86400, stale-while-revalidate=604800` (checked on `next start`). Search matches the start of any word, ignoring accents and case.

## Phase 4 (2026-10-01)

- Río Negro is the whole basin, not the stretch below the confluence. It is the root of the hierarchy (`level 0`); Limay, Neuquén and the endorheic areas are its children (`level 1`, `parentId: "negro"`). Its own area, the land that drains straight to the Río Negro, is drawn in a third colour and opens the whole-basin panel.
- A river sub-basin is everything upstream (HydroBASINS level 12 `NEXT_DOWN`) of the polygon holding its river's mouth reach (`pipeline/subbasins.config.json`), minus endorheic polygons (`ENDO > 0`).
- Endorheic land is its own node (`kind: "endorheic"`, no name, river or outlet; labelled per locale), not part of any river sub-basin, even where HydroBASINS links it virtually. Revised the same day: at first it followed the virtual links, which put a 9,365 km² endorheic area north of the confluence into the Río Negro. It hides with the endorheic filter.
- The own areas partition the basin: Limay 59,868 km², Neuquén 34,536 km², Río Negro direct drainage 18,637 km², endorheic 23,163 km² (17 parts); sum = basin, 0 km² overlap and gap (`data/work/subbasins/report.json`). River sub-basins match their mouth's `UP_AREA` within 0.1%. Every endorheic reach lies in an endorheic polygon and no connected reach does. 6 invalid level-12 polygons are repaired with `ST_MakeValid`.
- Reaches are assigned by their `HYBAS_L12` attribute. The connected reaches of each sub-basin equal the HydroRIVERS upstream set of its mouth reach (0 mismatches), and every reach midpoint lies in its owner's polygon.
- Sub-basin metrics sum or `CATCH_SKM`-weight the RiverATLAS catchment attributes (`pop_ct_csu`, `lka_pc_cse`, `inu_pc_cmn/cmx`, `ele_mt_cmn/cmx`) over the node's land. For the whole basin that includes endorheic areas, so it exceeds the river panel's upstream values (population 765,417 vs 600,371). Units are confirmed by the report: over connected reaches they reproduce the mouth's upstream values (population within 0.01%). Discharge and dam regulation are taken at the mouth reach.
- `public/tiles/subbasins.pmtiles` (151 KB) is built with `--detect-shared-borders`. Colours sit under the Visible Land mask; borders are drawn above it. The view mode is not in the URL on its own; `?s=` implies the sub-basin view.

## Gate: IGN data (2026-10-01)

- IGN line layers ("Corriente de agua perenne" and "intermitente", Shapefile) were downloaded on 2026-10-01 into `data/raw/ign/`. IGN's terms are custom, not CC BY (see `pipeline/SOURCES.md`): credit "FUENTE: Instituto Geográfico Nacional de la República Argentina", the date of the original data, and no endorsement claim.
- Perennial lines in the basin: 10,556 features, 13,635 km (HydroRIVERS: 8,016 reaches, 35,083 km), 84% of the km named, 494 distinct names. Lengths agree on the main rivers (Río Negro 723.7 km IGN vs 710.7 km HydroRIVERS; Limay 548.1 vs 555.3).
- Extra detail is marginal: IGN perennial km beyond 100 / 250 / 500 m of any HydroRIVERS reach is 56.5% / 26.2% / 16.8% of IGN km, adding 22% / 10.2% / 6.5% over HydroRIVERS. The rule (≥ 20% and ≥ 10%, at 250 m) passes only narrowly and fails at 500 m. HydroRIVERS comes from a coarse grid, so part of this is positional offset, not missing streams.
- Names are the main gain: up to 5,815 km (18.4%) of the 31,572 km of HydroRIVERS with no river name lies within 250 m of a named perennial IGN line (6,511 km, 20.6%, at 500 m). This is a proximity upper bound; the real figure comes from the Phase 5 match.
- Intermittent lines: 63,685 features, 77,682 km in the basin, 5.7% of the km named; 75% of the km is beyond 250 m of HydroRIVERS. Large, mostly unnamed geometry.
- **Scope chosen (owner, 2026-10-01): names + perennial detail layer.** Phase 5 keeps the match with confidence scores, the names, and a detail layer of unmatched perennial lines. **The intermittent layer is out of scope** (tile size and the committed PMTiles in `/public`, and almost no names); revisit only with a size and cost check. Because of the positional offset, "unmatched" must be judged with a buffer of at least 250 m plus overlap, not by distance alone.
- Caveats: distances are in Albers, so approximate; only exact duplicate lines were removed (overlap 0.1% for perennial, not measured for intermittent); no combined perennial + intermittent coverage was computed.

## Phase 5 (2026-10-01)

- **IGN names win (owner).** A name is IGN's `fna` verbatim (cleaned for Unicode and spaces only). The 15 approved rivers take the IGN name where it differs from the OpenStreetMap one: `Río Chimehuin` becomes `Río Chimehuín` and `Arroyo Pichileufú` becomes `Río Pichi Leufú`. The other 13 already agree. The old names stay searchable (`aliases` in `pipeline/names.json`). River ids (`slug`) do not change: `names.json` now carries an explicit `slug`, so links like `?r=pichileufu` keep working. Basis: the IGN name covers 62–100% of each river's main stem that has an IGN candidate (`data/work/ign-match/report.json`), 15 of 15 at ≥ 0.6. IGN draws no line through reservoirs, so the vote is over stem km with a candidate (the Limay's stem is 42% candidate km, 95% of it "Río Limay"); at least 50 km of evidence is required (provisional).
- **Match rule.** A reach and an IGN name are compared by coverage: the share of the reach within 250 m (Albers, as the gate) of the lines with that name. Names are grouped by a key without accents, case or punctuation (`Río Negro (Brazo Norte)` = `Río Negro Brazo Norte`). Tiers (`pipeline/ign.config.json`): high = coverage ≥ 0.8 and lead ≥ 0.3; medium = ≥ 0.3 and lead ≥ 0.3; low = ≥ 0.2; below that, no candidate. High and medium are shown; the rest stay hidden, which is the safe default (no name rather than a wrong one).
- **Calibration, and its limit.** The first thresholds (medium ≥ 0.5, lead ≥ 0.2) were chosen before looking at the data. On the 15 approved stems, correct matches often have coverage 0.34–0.5 (55 of the 700 correct reaches fell in "low"), because the IGN line is offset or stops short, so medium moved to 0.3 / 0.3. There is no independent ground truth for tributaries: the stems are the only check, and some stem reaches that match another name at full coverage are probably branches IGN names differently, not errors. Thresholds stay provisional until the review is done.
- **Results.** Before triage, 2,213 of 8,016 reaches show an IGN name (high 1,695, medium 518; 8,779 km). 18.8% of the km with no river name today gain one (5,928 of 31,572 km; the gate's proximity bound was 18.4%, a bit lower because it counted only the covered part of each reach). 5,575 reaches (25,677 km, 73%) have no IGN candidate, mostly small streams the perennial layer does not draw; the intermittent layer was left out. 228 reaches (627 km) are low or ambiguous. 412 IGN names (besides the approved rivers) are searchable.
- **Triage.** The owner accepted the proposal in bulk (2026-10-01) and will review it later: 180 of the 228 low or ambiguous reaches (421 km) are shown, because the same name is already shown on the next reach up or downstream; they are in `pipeline/ign-overrides.json` (`accept`, with a note each). That brings the reaches with an IGN name to 2,393 (19.9% of the unnamed km). The other 48 (206 km) stay hidden in `review.json`; accepting changes the continuity, so 6 more now qualify, which was not applied.
- **Detail layer (perennial lines HydroRIVERS lacks).** The part of an IGN line farther than 250 m from every reach, in pieces of at least 500 m (provisional), cut out of all lakes: 1,837 pieces, 2,981 km (about 60% of the km named, measured before the lake cut), name and length only. 561 km of shorter pieces and 24 km inside lakes were dropped. It sits below the mask, so it shows only on visible land, and it has a toggle (on by default) and a legend entry.
- **Lakes (owner: option B).** 155 of the 245 HydroLAKES lakes take an IGN name (the IGN polygon covers ≥ 50% of the lake); all 8 HydroLAKES names are replaced (e.g. `Chocon Reservoir` becomes `Embalse Ezequiel Ramos Mexía`). IGN water polygons that HydroLAKES covers less than 50% are added as extra lakes, minus the HydroLAKES part: 691 pieces, 110 km² (4 reservoirs, 687 water bodies, 105 of them endorheic), at least 0.01 km² each (about 112 smaller polygons, 0.6 km² in all, are dropped; measured on the < 10% coverage group). The extra lakes are drawn below the mask, like the detail lines, so `mask.pmtiles` is unchanged (a punch-through would add a large binary diff and visual noise from ~700 ponds). Area is approximate (Albers, and the lake polygons are not IGN's survey).
- **Dams.** 10 points (`Dique`) and 24 wall lines (`Muro de embalse`) in the basin, 4 and 10 named, drawn above the mask and clickable. They replace GRanD for dam locations, whose terms are unverified. Name and position only.
- **Tiles.** `public/tiles/ign.pmtiles` is 323 KB (budget 500 KB); `rivers.pmtiles` grows from 846,910 to 885,713 bytes (lake names). Zoom steps for the IGN layers (`map.config.json`, `ign`) are provisional until seen on the map. Clicking a dam, a wall, a detail line or a lake opens a panel from the tile's own properties: it has no API document and says that no hydrology is available.
- **Data model.** Reach documents carry `ign: {name, confidence, reviewed} | null`; a new `ignNames` collection (412 docs) serves search, which now returns rivers and IGN names. A name shared by unrelated streams (`Arroyo Blanco`) opens its longest reach and fits the map to all its reaches. `npm run seed` was run on Atlas on 2026-10-01 (15 rivers and 8,016 reaches modified, 412 IGN names added, all seed checks true). Search for `nireco` or the old name `chimehuin` returns the right results from the API.
- **Dropped.** Provincial boundaries (owner, 2026-10-01): no local source and none verified.
- **Open.** (1) The date of the original IGN data (clause 4) is not recorded, so no date is shown (owner: later). (2) The BH130 reservoir outlines list "Esri-World_Imagery_2010" in their source field; the effect on terms is unverified (`pipeline/SOURCES.md`). (3) The two river-name changes and the weak/strong confidence of `Río Caleufú` (still `weak`, from the OSM evidence, though IGN covers 62% of its stem) were not reviewed beyond the vote.
- **Pipeline order** is now `… named`, `lakes`, `ign`, `ign-match`, `ign-layers`, `export`, `mask`, `subbasins`, `tiles`: `export` reads the IGN names and `tiles` reads the IGN layers.
