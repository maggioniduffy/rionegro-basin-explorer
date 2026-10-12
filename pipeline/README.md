# Data pipeline

TS scripts, run with `tsx`, that orchestrate DuckDB, GDAL/ogr2ogr and tippecanoe. Each step:

- is idempotent;
- reads from `data/raw/` or an earlier step's output in `data/work/<region>/`;
- writes a `report.json` (counts, total km, orphan segments, area checks) next to its output.

Final artifacts: NDJSON for `npm run seed` in `data/out/<region>/`, and PMTiles for the map in `public/tiles/<region>/`
(committed, because Vercel serves them from `/public` and tippecanoe does not run there).
Licenses and citations for every input are in [SOURCES.md](./SOURCES.md).

**Regions.** Every step works on one region and **requires** it: `npm run pipeline:<step> -- --region <id>`
(or `--region=<id>`; `nqn` is the Río Negro basin). Without it a step stops before touching any file,
so one region's run can never overwrite another's. The same holds for `seed`, `atlas:check`,
`landing:sample`, `inspect:file` and `scripts/og-shapes.ts`. The headings below omit the flag. Its configs are in `regions/<id>/`, its work
and output files in `data/work/<region>/` and `data/out/<region>/`. `data/raw/` is shared. Work
files from before regions (2026-10-10) move once: `mkdir -p data/work/nqn && mv data/work/* data/work/nqn/`
(the `mv` warns that it can't move `nqn` into itself; that is expected).

Status: Phase 1 is complete (`download` … `export`). Phase 2 adds `mask` and `tiles`; Phase 4 adds
`subbasins` (run it after `export` and before `tiles`). Phase 5 adds `ign`, `ign-match` and `ign-layers`
(`ign-gate` is the measurement that preceded it), and `ign-streams` (after `ign-match`, before `export`).
Order (2026-10-09): … `osm-names`, `ign`, `ign-match`, `named`, `lakes`, `ign-streams`, `ign-layers`,
`export`, `mask`, `subbasins`, `tiles`. `named` trims each river to its IGN line, so it runs after
`ign-match`; `ign-match` no longer reads `named` (its stem vote uses the area trace it computes itself).
`lakes` and `ign-streams` read the trimmed rivers; `export` reads the IGN names and streams, and `tiles`
reads the IGN layers from `ign-layers`.

## Prerequisites

| Tool       | Used for                           | Check                      |
| ---------- | ---------------------------------- | -------------------------- |
| DuckDB     | Reading, joins, geometry (spatial) | installed by `npm install` |
| `unzip`    | Extracting downloads               | `unzip -v`                 |
| tippecanoe | GeoJSON → PMTiles (`tiles`)        | `tippecanoe --version`     |

Install notes:

- **DuckDB**: the `@duckdb/node-api` devDependency. The spatial extension is fetched by DuckDB on
  first use (`INSTALL spatial`) and includes its own GDAL, so it reads Shapefile and FileGDB
  directly. System GDAL (`ogr2ogr`) is handy for ad-hoc checks but not required.
- **tippecanoe**: build from https://github.com/felt/tippecanoe; recent versions write `.pmtiles`
  directly. The build needs the SQLite headers. Without sudo (dev machine, 2026-09-30,
  tippecanoe v2.82.0): build the SQLite amalgamation from https://www.sqlite.org/download.html
  (check its SHA3-256 against that page) into `~/.local/{include,lib}/`, then run
  `CFLAGS=-I$HOME/.local/include CXXFLAGS=-I$HOME/.local/include LDFLAGS=-L$HOME/.local/lib make -j tippecanoe tippecanoe-decode tile-join`
  and copy the three binaries to `~/.local/bin`. `pipeline:tiles` uses `tippecanoe` from PATH,
  or `$TIPPECANOE`.

Disk: the global FileGDBs are large: RiverATLAS is 7 GB and GIRES is 3.3 GB extracted.
`pipeline:rivers` caches the basin's rows from each to Parquet. After that, the FileGDB folders can be
deleted; on the dev machine they have been. If the reach selection changes, the step asks for the
source again: remove `data/raw/<id>/.source.json` and rerun `pipeline:download`.

## Steps

### `npm run pipeline:download`

Fetches the sources listed in `pipeline/sources.ts` into `data/raw/<id>/`, extracts them and deletes
the archive. SHA-256 of each archive is recorded in the committed `pipeline/checksums.json`
(`downloadedAt` is a UTC date). Extracted folders carry a `.source.json` marker with the checksum, so
reruns skip finished sources. If upstream re-uploads a file and its checksum changes, the step fails;
review the change, then rerun with `-- --accept-new` to record the new checksum.

### `npm run pipeline:inspect`

Writes one JSON file per layer to `data/work/<region>/inspect/`: columns and types, feature count, CRS, extent
and three sample rows. `data/work/<region>/inspect/report.json` summarizes all layers. **Later steps only use
attribute names that appear there.**

### `npm run pipeline:basin`

Delineates the basin from HydroBASINS level 12. Configuration is in `regions/nqn/basin.config.json`.

1. **Outlet.** Picks the sea-draining HydroRIVERS reach (`NEXT_DOWN = 0`) with the largest
   `UPLAND_SKM` inside a search box and reports it with the runners-up.
2. **Members.** Takes the level-12 polygon holding that reach plus everything upstream via
   `NEXT_DOWN`, and checks that this equals the `MAIN_BAS` group.
3. **Dissolve and measure.** Writes `data/work/<region>/basin/basin.geojson` and `hybas_l12.parquet`.

Area has two definitions. HydroBASINS links some endorheic sinks to the surrounding basin through
a "virtual" `NEXT_DOWN` (TechDoc v1c), and `UP_AREA` excludes those regions:

- **total**: every traversed polygon; this is the outline written to `basin.geojson`.
- **connected**: only polygons with surface flow to the outlet (`ENDO = 0`).

The report compares the outlet's `UP_AREA`, the sums of `SUB_AREA`, and the dissolved polygon's
geodesic and Albers areas. It also checks the result against `reference.areaKm2` ± `tolerancePct`.

### `npm run pipeline:rivers`

Selects every HydroRIVERS reach whose `HYBAS_L12` is a basin member and tags each one with a
`network` value:

- `connected`: drains to the Río Negro outlet.
- `endorheic`: in an inland drainage inside the basin outline.

The map can use `network` to hide endorheic reaches, and network traversal skips them. Nothing is
filtered by flow. HydroRIVERS keeps intermittent streams, but no v1.0 source labels them.

It then adds GIRES flow-intermittence predictions (`predprob1`, `predcat1`, `predprob30`,
`predcat30`) with a left join. GIRES has no prediction for zero-flow reaches, which stay null.

It also joins every RiverATLAS column by `HYRIV_ID`. The first run scans the global FileGDB (about
3 minutes) and caches the basin subset to `data/work/<region>/rivers/riveratlas_basin.parquet`, keyed by a
hash of the reach IDs. After that the 7 GB FileGDB is only needed if the basin changes.

The report checks:

- orphans (a downstream ID outside the selection);
- a single connected outlet;
- completeness against the outlet's `MAIN_RIV`;
- a midpoint-in-polygon cross-check;
- a 1:1 join with matching shared fields (float32 tolerance for `LENGTH_KM` and `UPLAND_SKM`);
- `LENGTH_KM` against geodesic length.

### `npm run pipeline:candidates`

Lists the major branches of the connected network so they can be named in `regions/nqn/names.json`
(HydroRIVERS has no names). A candidate is either the outlet reach, or a branch at a confluence where
at least two branches drain ≥ 2,000 km² (`-- --min-area=<km²>` to change). Both branches of such a
confluence are listed. Each candidate's segment runs up the largest branch to the next candidate
confluence. Segments do not overlap. Writes `data/work/<region>/candidates/candidates.json`
(with OpenStreetMap links at each mouth) and `candidates.geojson` for a GIS viewer.

### `npm run pipeline:osm-names`

Name evidence from OpenStreetMap (ODbL; see SOURCES.md). The step makes **one** Overpass request
for the named waterways and water bodies in the basin bbox, cached in
`data/work/<region>/osm-names/overpass.json`, so reruns send nothing. It retries on 429 and 504, which the
public instance returns when busy. Each candidate segment gets up to five sample points, matched
locally to OSM lines within 750 m. `matches.json` lists the names per candidate, such as
"Río Limay 5/5". A person reviews it to write `regions/nqn/names.json`.

### `npm run pipeline:localities`

Cities, towns and villages from OpenStreetMap (ODbL; see SOURCES.md). One Overpass request for the
named `place=city|town|village` nodes in the basin bbox, cached in
`data/work/<region>/localities/overpass.json` (retries on 429 and 504). DuckDB keeps the nodes inside
`data/work/<region>/basin/basin.geojson` and writes `data/work/<region>/tiles/localities.geojson` (id, name, place; no
population). Report: counts inside and outside the basin, per class; checks: unique ids, all named,
all inside the basin. Places mapped only as areas are not included. Run it after `basin` and before
`tiles`, which writes `public/tiles/<region>/localities.pmtiles` with a minzoom per class
(`map.config.json`, `localities`).

### `npm run pipeline:named`

Traces every river in `regions/nqn/names.json`, a hand-approved list keyed by mouth reach, with OSM
evidence for each name. Runs after `ign-match`. A river runs where its IGN name runs (owner rule,
2026-10-09; IGN is the authority): from its mouth upstream it follows the reaches whose IGN line
carries the river's name (`ign-match/cover.parquet`; `traceAlongName` in `pipeline/lib/name-trace.ts`).

- **On the line:** the name covers at least `line.minCoverage` (0.5, `ign.config.json`) of the reach.
  The part of a reach inside a HydroLAKES lake is left out of that share (IGN draws no line in lakes),
  so a lake-outlet reach counts by its part on land.
- **In between only:** reaches with less coverage, and reaches with none (at most `line.maxGap` = 2 in a
  row), are kept only between two reaches on the line, never at the upstream end. Reaches within
  `bufferM` of a lake do not count as gaps, so a river crosses its reservoirs and lakes, and stops at a
  lake whose far side carries another name (the Chimehuín at Lago Huechulafquen, not up the Paimún).
- **Forks:** it follows the branch with the most IGN evidence (km × coverage), not the larger area, and
  never enters another approved river's mouth.
- **Mouth:** never trimmed; leading reaches without the name (a reservoir) are kept.
- **Override:** `sourceReach` + `sourceEvidence` in `names.json` replace the trace by the path from that
  reach to the mouth, for cases the rule cannot see (IGN's line offset beyond the buffer). The report
  lists them under `flagged`.

`source.kind` is `headwater` (no reach upstream), `lake` (its upstream end within `bufferM` of a lake)
or `confluence`. Reaches cut off a river go back to the pool for `ign-streams`. The step writes
`data/out/<region>/rivers.ndjson` (committed; seed input) and `data/work/<region>/named/river_reaches.parquet`
(reach → river).

Calibration of `line.minCoverage` (2026-10-09): on the approved rivers the trimmed sources are the same
at 0.4 and 0.5 (at 0.3 the Comallo and the Malleo end on other upper reaches). Río Currhué's upper reach 61552597, which
the owner identified as off the IGN line, has 0.37, so the threshold must be above it; 0.5 means the
line runs along at least half the reach. `ign-streams` reports the effect of 0.3–0.6 on streams.

Each document carries per-field provenance:

- **Length:** sum of `LENGTH_KM`.
- **Mouth elevation:** `ele_mt_cmn` of the mouth reach.
- **Source elevation:** the headwater reach's `ele_mt_cmn` plus its own drop.
- **Drop:** source elevation minus mouth elevation.
- **Discharge at the mouth:** `DIS_AV_CMS`, modeled.
- **Non-perennial share:** GIRES, modeled.

The sum of per-reach drops is reported only as a diagnostic, because it overstates on flat braided
reaches.

Checks: unique IDs, no reach in two rivers, every river flows into a named river or the sea (walking
through reaches on no river, which the report lists in `throughUnnamedToReceivingRiver`), exactly one
river reaches the sea, every source (without an override) on its line, every mouth kept, and the
owner's source list agrees (`sourceCheck` in `names.json`: the outlet of a given HydroLAKES lake, not
cut at a lake, or a confluence of two IGN names). The report compares each river with the area trace
(`trace`: km, source reach, km trimmed, lakes at the source).

### `npm run pipeline:lakes`

HydroLAKES v1.0 polygons that intersect the basin, clipped to it. The first run (of this step or
`named`, `pipeline/lib/hydrolakes.ts`) scans the global shapefile once and caches its basin-bbox subset
in `data/work/<region>/lakes/hydrolakes_bbox.parquet`.

HydroRIVERS draws flow paths across lakes, and this step removes those lines from the map.

- **Every lake:** the parts of reaches inside it are cut away.
- **Exception:** the reservoirs approved in `regions/nqn/lakes.json` keep the line of their main river.
  The main river is the named river (`pipeline:named`) of the lake's largest-`UPLAND_SKM` reach,
  i.e. its outflow path.
- **Slivers:** clipped pieces under 50 m are dropped, since they are artifacts where a line grazes a
  shore.
- **Reach data is unchanged.** Only the geometry drawn on the map changes, and `export` uses it.

`candidates.json` lists the reservoirs (`Lake_type` 2) and controlled lakes (3) that have a named
main river, for review. Approved entries go into `lakes.json` with evidence. The step fails if an
approved entry's river disagrees with the data.

The report checks:

- every lake geometry is valid;
- the approved lakes match the data;
- the main river inside each approved lake is unchanged (within 0.5%).

It also lists the km removed and the largest lakes. The step writes `lakes.geojson`, which is used for
the mask hole and the `lakes` outline layer.

### `npm run pipeline:export`

Writes the Phase 1 artifacts:

- `data/out/<region>/reaches.ndjson`: one document per reach (gitignored, about 3 MB). Each carries `stream`
  (its stream id from `ign-streams`, or null; it can be set together with `river`). `ign` is null for
  the reaches `ign-streams` dropped as off the IGN line (`dropped.json`).
- `data/out/<region>/streams.ndjson`: one document per stream from `ign-streams` (replaces `ign-names.ndjson`):
  name, mouth reach, reach count, `lengthKm` (sum of `LENGTH_KM`), bbox, `subbasin` (first sub-basin
  mouth on the way down from the stream's mouth, see `streamDrainage`), `receivingRiver`, and the
  mouth-reach values with `modeled` and `provenance`, as in `rivers.ndjson`. Needs `ign-streams`
  and `named` (`data/out/<region>/rivers.ndjson`) first.
- `data/work/<region>/tiles/reaches.geojson` and `basin.geojson`: tippecanoe inputs for Phase 2.
- `data/out/<region>/report.json`: the combined, committed report. It covers counts, km, orphans, the area
  check and the named rivers.

Only RiverATLAS fields whose catalog units were checked are exported (`ele_mt_cmn`, `sgr_dk_rav`).

### `npm run pipeline:mask`

Polygons for the "Visible Land" slider, from `regions/nqn/map.config.json`. For each level in
`mask.baseHalfWidthKm`, every reach is buffered on each side by that width times
`mask.strahlerFactor[order]`, in South America Albers (ESRI:102033). Endorheic reaches are included.
The buffers are unioned and clipped to the basin to make the visible "hole". The mask is the
`bounds` rectangle minus the hole. A final level uses the whole basin as the hole. The app sets the
same `bounds` as the map's `maxBounds`, so the edge of the mask is never on screen. Lakes from
`pipeline:lakes` are part of the visible hole at every level.

Output: `data/work/<region>/tiles/mask.geojson`. The report lists each level's visible area, its % of the
basin and its vertex count. It checks that every geometry is valid, that the visible area grows
with each level, and that the last level is the whole basin.

### `npm run pipeline:subbasins`

Builds the sub-basin hierarchy listed in `regions/nqn/subbasins.config.json` from HydroBASINS level 12.
The root (`negro`) is the whole basin; level 1 is `limay`, `neuquen` and `endorheic`; levels 2–4 are
the other approved rivers of `regions/nqn/names.json`, nested by where they flow (`collon-cura` and its
four tributaries under `limay`, and so on). A parent is listed before its children; the config's
structure (levels, parents, no cycles) is checked before anything runs.

1. **Sets.** A river node is the level-12 polygon holding its river's `mouthReach` plus
   everything upstream via `NEXT_DOWN`. Below the root, endorheic polygons (`ENDO > 0`) are left
   out, even where HydroBASINS links them to the river virtually: they drain to closed depressions.
   The `endorheic` node holds all of them (23,163 km² in 17 parts).
2. **Partition.** A node's own area is its set minus its children's sets. The own areas must
   partition the basin: their areas sum to the outline, with no overlaps or gaps over 1 km².
3. **Reaches.** Assigned by `HYBAS_L12`. The connected reaches of each river node must equal the
   HydroRIVERS upstream set of its mouth reach, and every endorheic reach must lie in an endorheic
   polygon (and no connected reach in one).
4. **Metrics.** Summed or `CATCH_SKM`-weighted over RiverATLAS catchment attributes (`pop_ct_csu`,
   `lka_pc_cse`, `inu_pc_cmn/cmx`, `ele_mt_cmn/cmx`), endorheic catchments included. Over the
   connected reaches they must reproduce the upstream values at the mouth, which confirms the units.
   Metrics cover the node's whole set, so a parent includes its children; the report checks that
   no child exceeds its parent, that every node keeps some own area (so it can be clicked), and
   that each river node's connected area matches HydroRIVERS `UPLAND_SKM` at its mouth within 1%.

Outputs: `data/out/<region>/subbasins.ndjson` (committed, seed input; each node carries its `path` from the
root), `data/work/<region>/tiles/subbasins.geojson` (own areas, one feature per sub-basin, with the path as a
`,negro,limay,…,` string so the map can match a subtree) and `subbasin_outlines.geojson` (each node's
whole area, for the selected border).

### `npm run pipeline:ign-gate`

Read-only measurement for the gate before Phase 5: what do IGN's watercourse lines add over
HydroRIVERS? Nothing it writes feeds the app. Needs the IGN line layers unzipped in
`data/raw/ign/lineas_de_aguas_continentales_perenne/` (required) and `..._intermitente/`
(optional; skipped if missing), plus `basin`, `rivers` and `named`. Layer origin and terms:
[SOURCES.md](./SOURCES.md). It runs in about 2 minutes; set `IGN_GATE_PROXIMITY=perennial` to skip
the intermittent class in the proximity part.

1. **Clip.** IGN lines touching the basin, exact duplicates dropped, clipped to the basin polygon
   (`ign_basin.parquet`). Km are spheroid km; the bbox figure is reported too.
2. **Names.** Share of features and km with `fna`; IGN km under each approved river name against
   that river's HydroRIVERS km (a cross-check on lengths).
3. **Proximity** (Albers, so distances are approximate), at 100, 250 and 500 m: IGN km farther
   than the buffer from every HydroRIVERS reach; HydroRIVERS km (by Strahler order) farther than
   it from every IGN line of a class; and HydroRIVERS km with no river name today that lie within
   it of a named IGN line. This is a proximity bound, not the Phase 5 matcher.
4. **Verdict.** The PLAN.md rule at 250 m (IGN km beyond the buffer is at least 20% of IGN perennial
   km and at least 10% of HydroRIVERS km), with the same figures at the other buffers.

Output: `data/work/<region>/ign-gate/report.json`. Checks: IGN present, HydroRIVERS km equals the `rivers`
report, clipped km within bbox km, deduplication never adds features. The overlap figure (unioned vs
summed length) is computed for the perennial class only.

### `npm run pipeline:basin-gate -- --region <id>`

Gate R2 for a region with several basins (`cba`): which reference basins (APRHI's for `cba`) to
include, and how well HydroBASINS level 12 reproduces them. Read-only; the one output R3 reuses is
the level-12 → basin assignment. Reads `regions/<id>/gate.config.json` (province polygon, reference
basins and sub-basins), HydroBASINS level 12 and HydroRIVERS. Runs in under a minute.

- **Assignment.** A level-12 polygon joins the reference basin holding the largest share of its area
  if that share is at least `assignMinShare` (ties to the lowest code); the rest stay unassigned.
- **Per basin.** APRHI area and share inside the province; HydroBASINS area, IoU with the APRHI
  polygon, the APRHI part not covered and the HydroBASINS part outside it; ENDO counts.
- **Roots.** The group's terminal polygons: `sea`, `sink` (ENDO 2, NEXT_DOWN 0), `virtual-sink`
  (ENDO 2 with a HydroBASINS virtual NEXT_DOWN) or `flows-out` into another group (`intoCode`).
  Roots of 100 km² UP_AREA or more are listed. `upstreamOutsideKm2` is the SUB_AREA upstream of the
  roots that lies outside the group: where the reference outline cuts a HydroBASINS drainage.
- **HydroRIVERS.** Reaches, km and endorheic km per group, and the largest exit reaches
  (`disAvCmsModeled`: modeled natural average discharge, 1971–2000).
- **Coverage.** Province area covered by assigned polygons; per sub-basin IoU (median, and those
  below 0.6).

Areas in South America Albers. Checks (the step throws after writing the report if any fails):
province found, reference basins inside `searchBbox`, no overlap among them, each level-12 polygon
assigned at most once, SUB_AREA within 2% of polygon area per group, at least 98% of the province
covered. Outputs in `data/work/<id>/basin-gate/`: `report.json`, `lev12_groups.parquet` (HYBAS_ID,
code, share, areaKm2, inProvinceKm2) and `groups.geojson` (dissolved per basin, for viewing).

### `npm run pipeline:lines-gate -- --region <id>`

Gate R2: what each line source adds inside the region's province. Compares HydroRIVERS, IGN
perennial (`ign_perennial`), IGN perennial plus intermittent (`ign_all`) and the provincial lines
(`referenceLines` in `gate.config.json`, label `aprhi` for `cba`). Read-only; runs in about a minute.

- **Clip.** Each source clipped to the province, exact duplicates dropped and counted. Per source:
  features, spheroid km, named km, distinct names, self-overlap (summed vs unioned km), km by class
  and status (reference lines) and by Strahler order (HydroRIVERS).
- **Proximity** (Albers, approximate) at 100, 250 and 500 m: for every ordered pair (A, B), the km of
  A farther than the buffer from every line of B, split by Strahler order when A is HydroRIVERS. In
  the `ign_all` vs `ign_perennial` cell only the intermittent lines count.
- **Names** at `bufferM`: HydroRIVERS km within the buffer of a named line of each source. Name
  agreement between reference-line and IGN names where they coincide: strict `nameKey`; with
  abbreviations (A., R., C., Cda., Q.) and parenthesised alternatives expanded; and lenient (also
  ignoring articles); plus the 15 largest disagreeing pairs.
- **Verdict** per candidate (`ign_perennial`, `ign_all`, reference lines) with the `ign-gate` rule at
  `bufferM`, and the other buffers as sensitivity.

`LINES_GATE_SKIP=ign_intermittent` (comma list of source ids) leaves sources out of the proximity
part. Checks: province found, every source non-empty, clipped km never above unclipped, deduplication
never adds features, far km never above total. Outputs in `data/work/<id>/lines-gate/`:
`report.json` and `lines_province.parquet` (source, id, name, class, status, ORD_STRA, km, geometry).

### `npm run pipeline:ign`

IGN perennial watercourse lines (`data/raw/ign/`, Shapefile, ISO-8859-1), cleaned and clipped to the
basin: touching lines only, exact duplicate geometries dropped, clipped to the basin polygon, names
cleaned (`pipeline/lib/names.ts`: NFC, spaces) and a stable `id` per line. A name is IGN's `fna` and
nothing is inferred: no `fna`, no name. Intermittent lines are out of scope (DECISSIONS.md, gate).

Output: `data/work/<region>/ign/lines.parquet`. Checks: unique ids, no empty geometry, clipped length within the
bbox, and the same 10,556 lines / 13,635.3 km as `ign-gate` (same inputs and rules). The report also lists
spelling variants (names that differ only by accents, case or punctuation) and `nam` values that are not
part of `fna`.

### `npm run pipeline:ign-match`

Matches IGN names to HydroRIVERS reaches and keeps the IGN lines HydroRIVERS lacks. Everything is
measured in Albers (approximate to a few percent). Settings: `regions/nqn/ign.config.json`; hand decisions:
`regions/nqn/ign-overrides.json`.

1. **Coverage.** For each reach and IGN name (compared by `nameKey`), the fraction of the reach within
   `bufferM` (250 m, as the gate) of the lines carrying that name. Every pair is written to
   `cover.parquet` (`named` and `ign-streams` follow lines with it). IGN lines listed under `lines` in
   `ign-overrides.json` (by IGN `gid`, action `unname`, with a note) lose their name first: an owner fact
   that contradicts IGN (the line between Lago Currhué Grande and Chico is not the Río Currhué).
2. **Tiers.** `classify` (`pipeline/lib/ign-match.ts`) turns the best name's coverage and its lead over the
   runner-up into high, medium, low or none. High and medium are shown; low and none are not. An override
   (`accept`, `reject`, `name`) decides a single reach and needs a note.
3. **Review.** `review.json` lists the low or ambiguous reaches, longest first, with the candidates.
   `proposed-overrides.json` proposes `accept` where the same name is already shown on the next reach
   upstream or downstream (the river continues through it); copy the entries you agree with into
   `regions/nqn/ign-overrides.json`. Not accepting costs nothing: a hidden name is the default.
4. **Approved rivers.** For each river in `names.json`, the IGN name along its candidate stem (the area
   trace from its mouth, computed here, since `named` runs later) is voted by km (over the stem km that
   has a candidate: IGN draws no line through reservoirs). The report proposes a name; `names.json` holds
   the approved result.
5. **Detail layer.** The part of each IGN line farther than `bufferM` from every reach, in pieces of at least
   `minDetailPieceM`. Name and length only.

Outputs in `data/work/<region>/ign-match/`: `reach_ign.parquet`, `cover.parquet`, `detail.parquet`, `review.json`,
`proposed-overrides.json`, `report.json`. Checks: every reach once, coverage within 0..1, near + far km
equal the IGN total, pieces not shorter than the minimum. The thresholds are provisional; see
DECISSIONS.md (Phase 5) for how they were calibrated.

### `npm run pipeline:ign-streams`

Splits each shown IGN name into real streams (detection only; `export` turns `streams.json` into `data/out/<region>/streams.ndjson`). Inputs:
`rivers/reaches.parquet` (`HYRIV_ID`, `NEXT_DOWN`, `LENGTH_KM`, geometry for the bbox),
`named/river_reaches.parquet` (`river`), `ign-match/reach_ign.parquet` (`name`, `name_key`, `display`)
and `regions/nqn/names.json`. A reach carries an IGN name when `display` is true; approved river names and
their aliases are left out, as in `export`.

Two reaches with the same name key are one group when one lies downstream of the other (`NEXT_DOWN`) and
the path between them crosses at most `line.maxGap` (2) reaches with no IGN name and no approved river.
Those reaches are absorbed. A reach with another IGN name, or on an approved river, breaks the path
(`detectStreams` in `pipeline/lib/streams.ts`).

A stream then keeps only the reaches the IGN line runs along (owner, 2026-10-09; `followIgnLines`): a
named reach is on the line when its name's coverage (`ign-match/cover.parquet`) is at least
`line.minCoverage` (0.5; calibration under `named`). Ends of a group that are not on the line (upstream
ends and the mouth) are pruned until every end is; so reaches below the threshold, and absorbed gaps,
stay only between two reaches on the line, and at a fork only the branches the line runs along stay.
Pruning a mouth that joined two branches leaves two streams, like same-name siblings. A group with no
reach on the line is dropped. Id: `<slug of the name key>-<mouth HYRIV_ID>`.

Outputs in `data/work/<region>/ign-streams/`: `streams.json` (id, name, nameKey, mouthReach, reachIds,
absorbedReachIds, lengthKm, bbox), `dropped.json` (named reaches off every line; `export` hides their IGN
name) and `report.json`: names considered and split, streams, reaches and km (named vs absorbed), the same
counts for a gap tolerance of 0, 1 and 2, `line` (groups, groups split or lost, reaches dropped, and the
same for a threshold of 0.3–0.6), and review lists (a gap reach claimed by two names, same-name streams
draining to the same receiving water, single-reach streams under 1 km). Checks: every named reach in
exactly one stream or dropped, every reach on the line in a stream, every stream end on the line, no
reach in two streams, no approved-river reach absorbed, unique ids.

### `npm run pipeline:ign-layers`

IGN lakes, dams and the detail lines, as tippecanoe inputs: names for HydroLAKES lakes (an IGN polygon
covering at least `water.lakeNameMinOverlap` of the lake), extra lakes (IGN water bodies HydroLAKES
covers less than `water.extraLakeMaxCoverage`, minus what it covers, at least `water.minExtraLakeKm2`),
detail lines cut out of every lake, and dam points and walls. Dam points listed under `dams` in
`regions/nqn/ign-overrides.json` (by IGN `gid`, each with a note) are dropped: points checked against the
imagery that mark no dam. Each feature gets `network` by the same rule as `pipeline:lakes`.

Outputs: `data/work/<region>/tiles/ign_lakes.geojson`, `ign_lakes_extra.geojson`, `ign_detail.geojson`,
`ign_dams.geojson`, `ign_dam_walls.geojson`; report in `data/work/<region>/ign-layers/`. Checks: one name per
lake, valid extra lakes, extra lakes outside HydroLAKES, detail lines outside lakes, no lake lost,
every rejected dam point found (a stale `gid` fails the step).

### `npm run pipeline:tiles`

Runs tippecanoe with the feature and tile-size limits off, except for the mask (below):

- `public/tiles/<region>/rivers.pmtiles`: layer `reaches`, with the properties the map styles on and a
  per-feature minzoom from `reachMinzoomByStrahler`; layer `basin`, the outline; layer `lakes`, the
  HydroLAKES polygons with IGN names (`ign_lakes.geojson` from `pipeline:ign-layers`).
- `public/tiles/<region>/mask.pmtiles`: layer `mask`, one feature per level, and layer `endorheic`. Built
  in two parts joined with `tile-join`: z0–7 at `--full-detail=10` (about 2 tile units per screen
  pixel), z8 and up at full detail, both with `--detect-shared-borders` and a 100 KB tile cap.
  tippecanoe lowers an oversized tile's detail rather than dropping features, and fails if it still
  doesn't fit. This keeps the worst tile near 75k vertices instead of ~274k (z6), which MapLibre
  would otherwise triangulate on every tile load while zooming. `tile-join` must be on PATH next to
  tippecanoe.
- `public/tiles/<region>/subbasins.pmtiles`: layers `subbasins` (the own areas from `pipeline:subbasins`) and
  `outlines` (each node's whole area), built with `--detect-shared-borders` so simplification leaves no slivers between neighbours.
- `public/tiles/<region>/ign.pmtiles`: layers `detail` (IGN streams HydroRIVERS lacks), `lakes_extra`, `dams` and
  `dam_walls`, each feature with a minzoom from `map.config.json` (`ign`: by length, by area, dams from
  z6). The report checks every feature is present at maxzoom and none before its first zoom.

The report decodes the tiles back. It checks that every reach is present from its minzoom up and
never before it. The only exception is a reach shorter than one tile unit at that zoom (an eighth of
a pixel), which tippecanoe drops because it collapses to a point. It also checks that every mask
level and every sub-basin is present at each checked zoom, and records file sizes and the tippecanoe version.

Full run order: `download` → `inspect` → `basin` → `rivers` → `candidates` → `osm-names` → `ign` →
`ign-match` → `named` → `lakes` → `ign-streams` → `ign-layers` → `localities` → `export` → `mask` →
`subbasins` → `tiles`.

## Tools

### `npm run inspect:file -- <path> --region <id> [--layer=<name>] [--samples=<n>]`

Profiles one file without dumping it: columns and types, row count, DuckDB `SUMMARIZE` stats (null
%, min/max, approximate distinct values, mean), geometry types, extent and invalid count, and three
sample rows without geometry. It reads Parquet, CSV, NDJSON and anything GDAL opens (GeoJSON,
Shapefile, or a FileGDB with `--layer`). The full profile goes to
`data/work/<region>/inspect/adhoc/<file>.json`. The `inspect-dataset` skill and the `data-inspector` agent
(`.claude/`) use it.

### `npm run inspect:tiles -- <file.pmtiles> [--by=<prop>]`

Per-zoom summary of a PMTiles archive: tile count, stored tile bytes (min / median / max) and,
per layer, features and vertices (total and worst tile). `--by=level` splits the mask's vertices
by level. Use it to check tile weight after changing `pipeline:tiles` flags.

Local-only inputs (not fetched by the pipeline): `data/raw/ign/` (IGN layers, for Phase 5) and
`data/raw/alos/` (one ALOS PALSAR scene, unused). See SOURCES.md.

Rule: inspect every source schema before using attribute names. Never guess them.
