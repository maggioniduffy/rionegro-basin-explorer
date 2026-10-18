<!-- Phase file. Index and status: [PLAN.md](../PLAN.md). -->

# Phase R3 — Córdoba pipeline & app (Phases 1–6 reused)

Plan approved 2026-10-12 ([DECISSIONS.md](../DECISSIONS.md#córdoba-r3-plan-2026-10-12)): precedence APRHI > IGN > HydroRIVERS, same app contract, HydroRIVERS as the hidden network.

- [x] R3.0 Inputs: re-download RiverATLAS and GIRES; delete them again (with their markers) after R3.2 caches the `cba` subsets — subsets cached in `data/work/cba/rivers/`, FileGDBs and markers deleted (2026-10-12)
- [x] R3.1 Region outline (APRHI polygons) and typed roots; Río Quinto headwaters from HydroBASINS — `pipeline:basin` reference mode, outline 291,118 km², headwaters 6,628 km² (2026-10-12)
- [x] R3.2 Hidden network: reaches per root, RiverATLAS/GIRES, `network-overrides.json` — cross-root edges cut; overrides need an APRHI line: Río Quinto main stem → 04, Río Cuarto → Saladillo → Carcarañá; southern arroyos stay endorheic in 03 (no APRHI link) (2026-10-12). Local preview: `npm run preview:map -- --region cba`
- [x] R3.3 Displayed lines: APRHI inside the province (no "Eliminado", "En revisión" flagged), IGN outside, each matched to a reach — `pipeline:lines`, 25,401 pieces, 44% of km matched (main rivers 62–84%), buffer 250 m / 1 km by Strahler order (2026-10-11). APRHI has no lines in 05 and 06 and 331 km in 04 (layer coverage; see [PENDING.md](../PENDING.md)). Heavy steps cap DuckDB at 4 GB, `PIPELINE_MEMORY_LIMIT` raises it on a larger machine
- [x] R3.4 Rivers and streams from APRHI names (`names.json`), IGN names as aliases — `pipeline:line-names` (abbreviations expanded, starred names blank, spelling fixes only by owner approval, IGN aliases at ≥ 50%), 13 rivers in `regions/cba/names.json` (2,436 km; four main-stem `sourceReach` overrides), 704 streams; `named`/`ign-streams`/`export` pick the name source per region (`namesFrom`), `nqn` unchanged (2026-10-12). Export for `cba` runs in R3.8; stream search aliases wait for R3.7
- [x] R3.5 Sub-basins from APRHI: region → 6 basins → 25 subcuencas → 80 UGH — `pipeline:subbasins` reference mode, 112 nodes of kind `area` (schema), parent by geometry, stable ids in `regions/cba/subbasin-ids.json`, outlets by the 90% rule (5 basins, 1 subcuenca, 18 UGH), salar and lagoon in their basin's own area; `nqn` unchanged (2026-10-12)
- [x] R3.6 Lakes and dams: APRHI > IGN > HydroLAKES; caveat names Córdoba's dams — `pipeline:lakes` / `ign-layers` reference mode, 2,202 polygons (APRHI 1,630, IGN 96, HydroLAKES 476 incl. Salinas Grandes), Mar Chiquita from APRHI, lines cut inside water, 39 IGN dams; the dam caveat list (26 APRHI Presa reservoirs) is in DECISSIONS.md for the region text in R3.8; `nqn` unchanged (2026-10-12)
- [x] R3.7 App contract: sink and region-edge mouths, root per reach, line source and status (no change for `nqn`) — `mouthKind` on rivers, reaches and streams (4 rivers end at the region's edge, 9 in sinks), distance to the sea null in sinks and across override links (the Río Cuarto system), `root` and `lineReview` per reach, piece tiles with source/status/display order, unmatched pieces clickable (owner), lake `source`, area wording in panels, ask box and prompt; `nqn` data byte-identical (2026-10-12)
- [x] R3.8 Localities, mask, map config, tiles, export, seed `basin-explorer-cba`; the map style matches Río Negro's (same layers, colours and widths; owner, 2026-10-11) — export, localities (687 places), mask, tiles (~15 MB, owner approved) all ok; `cba` served at `cordobabasinexplorer.vercel.app` (dev `cordoba.localhost:3000`) and listed on the hub. Owner, local: seed `basin-explorer-cba` + Atlas grant, landing image, browser pass ([RUN_LOCAL.md](../RUN_LOCAL.md)) (2026-10-12)

Original items:

- [ ] Basin step supports several roots: river outlets and endorheic sinks, each its own top-level node (no grouped endorheic node)
- [ ] Rivers that end in wetlands or sinks: the "mouth" is the terminal reach, flagged; no sea distance
- [ ] Names, IGN match/streams, sub-basins, localities, tiles, seed for `cba`; caveats name Córdoba's dams (San Roque, Los Molinos, Río Tercero, …)
- **Done when:** the same report checks as Río Negro pass for every root (partition, no orphans, child ≤ parent).
