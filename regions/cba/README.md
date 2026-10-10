# `cba` — Córdoba (stub, not served)

Córdoba province plus the nearby interprovincial basins that reach it, with each endorheic
basin as its own root (Mar Chiquita/Ansenuza, Salinas Grandes, …). Decisions:
[DECISSIONS.md](../../DECISSIONS.md#multi-region-2026-10-10); phases R2–R3 in
[PLAN.md](../../PLAN.md).

**Status:** known to the pipeline and the data scripts (`--region cba` is accepted, Mongo
database `basin-explorer-cba`), **not served** by the app: `cba.<host>` answers 404, and
`cba` is not in `REGION_IDS` (`regions/index.ts`). Nothing here is data yet.

## Before the pipeline can run (Phase R2–R3)

- [ ] `basin.config.json` — the basin step needs several roots (river outlets and endorheic
      sinks), not one sea outlet: a pipeline change (R3), decided from the R2 candidate list.
- [ ] `map.config.json` — extent, bounds and zooms come from the delineated basins
      (`pipeline:mask` checks `basinBbox`); never typed by hand. Same number of Visible Land
      levels as `nqn` (5 widths).
- [ ] `subbasins.config.json`, `names.json`, `lakes.json`, `ign.config.json`,
      `ign-overrides.json` — same shapes as `regions/nqn/`, with Córdoba's sourced content.
- [ ] Sources and licenses for anything new (e.g. the provincial "Cuencas y Unidades de
      Gestión" layer) in `pipeline/SOURCES.md` first.

## Before the app can serve it

Add `"cba"` to `REGION_IDS` in `regions/index.ts`. TypeScript then names each record below
that still lacks a `cba` entry; fill them in this order:

- [ ] `messages/{en,es}.json` — the same keys as `regions/nqn/messages/` (test).
- [ ] `content.ts` — featured rivers, landing sample picks, OG subtitle, ask prompt place,
      `within` phrases and examples (every slug must exist in `data/out/cba`; test). Export it
      as the default export too (`scripts/landing-sample.ts` reads it).
- [ ] `landing-sample.json` — `npm run landing:sample -- --region cba`.
- [ ] `og-shapes.json` — `npx tsx scripts/og-shapes.ts --region cba` (after `pipeline:tiles`).
- [ ] `public/landing/cba/basin.png` — a real screenshot of the map.
- [ ] Register each in `lib/map/config.ts` (`MAP_CONFIGS`), `i18n/messages.ts`
      (`REGION_MESSAGES`), `regions/content.ts`, `regions/generated.ts`, `regions/images.ts`.
- [ ] OG image `alt` per region (`generateImageMetadata` in `app/[region]/opengraph-image.tsx`).
- [ ] Seed `basin-explorer-cba`; give the read-only app user read access to it; run
      `npm run atlas:check -- --region cba`.
- [ ] Domain: the `cba` host (subdomain or a Vercel alias in `regions/hosts.ts`).
