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
CLAUDE.md  context/ (PLAN.md  phases/  PLAN_ARCHIVE.md  DECISSIONS.md  DESIGN.md)
.claude/             agents/ and skills/ (committed)
```

## Archived phases

Phases 0–6, the IGN gate, IGN streams, and the done items of Phases 7, 8 and Design v3 are in
[PLAN_ARCHIVE.md](PLAN_ARCHIVE.md). Read it only when you need the history of a finished phase.

## Phases

Each phase lives in its own file under [phases/](phases/). Read this index, then only the file of the phase you work on. A new phase gets a new file (checklist, owner decisions, design summary, "Done when") and a row here; tick items in the phase file and keep the row's status current.

| Phase                                             | Status                                                             | File                                                  |
| ------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------- |
| Phase 7 — Extras (ask box)                        | [~] owner steps left                                               | [p7-extras.md](phases/p7-extras.md)                   |
| Phase 8 — Release                                 | [ ] Atlas user on Vercel                                           | [p8-release.md](phases/p8-release.md)                 |
| Design v3 — Landing and restyle                   | [ ] regenerate `basin.png`                                         | [design-v3.md](phases/design-v3.md)                   |
| Design v6 — Landing v6 and restyle                | [~] e2e baselines and browser review left                          | [design-v6.md](phases/design-v6.md)                   |
| R0 — Multi-region decisions & inputs              | [x]                                                                | [r0-decisions.md](phases/r0-decisions.md)             |
| R1 — Region refactor                              | [x]                                                                | [r1-region-refactor.md](phases/r1-region-refactor.md) |
| R2 — Córdoba gate                                 | [x]                                                                | [r2-cba-gate.md](phases/r2-cba-gate.md)               |
| R3 — Córdoba pipeline & app                       | [x] (original items list kept)                                     | [r3-cba-pipeline.md](phases/r3-cba-pipeline.md)       |
| R4 — Hub                                          | [x]                                                                | [r4-hub.md](phases/r4-hub.md)                         |
| R5 — Continuous river courses in Córdoba          | [x]                                                                | [r5-cba-courses.md](phases/r5-cba-courses.md)         |
| F1 — Flow close-up (`nqn`)                        | [~] code done; owner browser checks left                           | [f1-flow-closeup.md](phases/f1-flow-closeup.md)       |
| I1 — Imagery, water tuning, reservoirs, CDN cache | [~] I1.0–I1.1 done (IGN imagery, nqn); I1.P next                   | [i1-imagery-water.md](phases/i1-imagery-water.md)     |
| F2 — Water network from Sentinel-2 (`nqn`)        | [x]                                                                | [f2-water-network.md](phases/f2-water-network.md)     |
| F3 — Flow engine on the water network             | [~] PR #10; reservoir box and zoom to I1.7                         | [f3-flow-network.md](phases/f3-flow-network.md)       |
| B1 — Content bucket and remote pipelines          | [x] B1.1–B1.3 done; B1.4 → I1.7, B1.5 → I1.6 (file merged into I1) | [i1-imagery-water.md](phases/i1-imagery-water.md)     |

### Multi-region (R0–R5)

One Next.js app serves every region (Option A, owner 2026-10-10); a region is a config folder, not a fork.
Decisions: [DECISSIONS.md](DECISSIONS.md#multi-region-2026-10-10).

## Open decisions

- PMTiles hosting: Cloudflare R2 through same-origin rewrites (B1); uncached since #13 (rewrite caching broke Range); Vercel cache in I1.6
- Official basin area figure for validation
- Exact sub-basin list per level: every AIC subcuenca is now a node, nested hydrologically rather than flat (see DECISSIONS.md Phase 6)

## Risks

- IGN↔HydroRIVERS matching in braided or flat reaches
- Sub-basin boundaries in transition zones and endorheic areas
- Imagery license for a public site
- Mask/buffer polygon performance with complex geometry
- Modeled 1971–2000 hydrology vs a heavily regulated basin (El Chocón, Piedra del Águila, Alicurá, etc.)
