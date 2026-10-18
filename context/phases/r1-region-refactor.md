<!-- Phase file. Index and status: [PLAN.md](../PLAN.md). -->

# Phase R1 — Region refactor, no behavior change ✅

Code and docs done in the cloud (2026-10-10, steps 1–8). Local checks passed (2026-10-11): the `nqn` pipeline re-run reproduces `data/out` and the reports, `npm run check` passes, the API answers per host. Left for the owner: browser, e2e and Vercel checks in [RUN_LOCAL.md](../RUN_LOCAL.md).

- [x] `regions/<id>/`: pipeline configs (basin, map, subbasins, names, lakes, ign-overrides), `region.ts` (title keys, featured rivers, OG text, LLM few-shot examples, data caveats such as the regulated-rivers text), messages (`region.*` namespace) — configs moved to `regions/nqn/` with the registry `regions/index.ts` (step 1, 2026-10-10)
- [x] Pipeline steps take `--region`; `data/work/<region>/`, `data/out/<region>/`; `data/raw/` and checksums stay shared (step 2, 2026-10-10; default `nqn`)
- [x] Tiles in `public/tiles/<region>/`; `TILE_PATHS` and `mapConfig` resolved from the region — tiles moved and versioned per region (step 3); the map and minimap read `tilePaths(region)` and `mapConfigFor(region)` from the region provider (step 5c, 2026-10-10)
- [x] Mongo: one database per region on the same cluster, `getDb(region)`; seed and `atlas:check` take `--region` (step 4, 2026-10-10; routes pass the default region until step 5)
- [x] Routes and the ask catalog, LLM cache key and rate limit read the request's region — queries, catalog (one per region) and cache key take it (step 5a, 2026-10-10); the routes read it from `app/[region]` since 5b. The rate limit stays per IP across regions (one LLM quota)
- [x] `proxy.ts` maps host → region (rewrite to `/[region]/…`); local dev via `<region>.localhost`; old `rionegrobasinexplorer.vercel.app` URLs keep working as `nqn` (step 5b, 2026-10-10)
- [x] Río Negro-specific strings and code (landing, `MapAccessCard`, OG image, icon, LLM prompt examples) move into `regions/nqn/` — strings (step 6a: `regions/nqn/messages/`) and content (step 6b: `regions/nqn/content.ts`, landing sample, OG shapes, landing image), 2026-10-10. The icon (Limay and Neuquén converging) stays the shared app logo
- [x] Stub `cba` region: accepted by `--region` (`KNOWN_REGION_IDS`), its own database name, not served (`cba.<host>` → 404); `regions/cba/README.md` lists what serving it needs (step 7, 2026-10-10)
- [x] `--region` required on every pipeline step and data script (owner, 2026-10-10)
- **Done when:** `npm run check` passes; re-running the pipeline for `nqn` reproduces the committed `data/out` and reports unchanged; the live `nqn` site behaves as before; a stub `cba` region builds. Cloud checks are done; the local ones (pipeline re-run, browser, e2e, Vercel) are in [RUN_LOCAL.md](../RUN_LOCAL.md).
