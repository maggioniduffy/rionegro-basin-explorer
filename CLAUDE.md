# CLAUDE.md — Río Negro Basin Explorer

Satellite river-and-tributary explorer (Next.js App Router, TypeScript strict, Tailwind, MongoDB Atlas only from
Server Components/Route Handlers, MapLibre + PMTiles, Zustand, next-intl EN+ES, npm, Vercel). One app, several
**regions** by path (`/rionegro` = `nqn`, `/cordoba` = `cba`).

## Read on demand only (not at session start)

- `context/PLAN.md` — phase index; then only the current phase's `context/phases/<id>.md`
- `context/DECISSIONS.md` — dated decisions; read before revisiting a choice, add new ones there
- `context/DESIGN.md` — UI/visual design; read only when working on UI
- `context/orchestration.md` — agent roles, WP briefs, reviewer triggers, phase gate; read only when running a phase

## Commands

- `npm run dev` · `npm run check` (typecheck + lint + tests, before every commit) · `npm run test:e2e`
- `npm run pipeline:<step> -- --region <id>` (`--region` required; see `/pipeline/README.md`)
- `npm run seed -- --region <id>`

## Layout

`/app/[region]` pages + `/api/*` · `/regions` (registry + one folder per region) · `/components`, `/lib`, `/messages`,
`/i18n` · `/pipeline` · `/data` (`raw/`, `work/` gitignored; `out/<region>/`) · `/.claude` (agents, skills)

## Rules

1. English for code, comments, commits, docs. All UI strings via i18n (`/messages/{en,es}.json`, or `regions/<id>/messages/`); river/place names are not translated.
2. No invented data: every number traces to a source field; unsourced = null. Inspect the real schema, never guess attribute names.
3. Flag uncertainty (licenses, data quality, library APIs) and say how to check it.
4. HydroATLAS values are modeled; the UI states the period wherever shown: discharge 1971–2000 natural average (ignores dams), population 2010 (GPWv4), flooded area 1993–2004 (GIEMS-D15), dams GRanD v1.1.
5. Never commit `data/raw`, `data/work`, secrets, `.env*`. `MONGODB_URI` is server-side only.
6. Keep context small: no `cat` of large geo files; use `head`, `jq`, DuckDB summaries. Heavy jobs run in the background with logs in `data/work/<region>/<step>/`.
7. Pipeline steps are idempotent and write `report.json`; verify from it.
8. Prefer free tiers; flag recurring cost.
9. Keep `/pipeline/SOURCES.md` updated; check a license before adding a source or imagery provider.
10. Work one phase at a time, one branch/PR per phase, one commit per work package (details in `context/orchestration.md`). `context/orchestration.md` overrides any global "work inline by default" orchestrator rules: the main session plans, briefs, reviews diffs, commits and keeps the docs; `scout` does the reading and `builder` writes every code change, including small fixes found in review. Tick the phase file and its `PLAN.md` row when done; record decisions in `DECISSIONS.md`.
11. Skip visual/chromium tests unless asked.
12. Always start tasks in PLAN MODE.

## Regions

- `KNOWN_REGION_IDS` (accepted by `--region`) vs `REGION_IDS` (served) in `regions/index.ts`; unserved = 404. Serving a new region: follow `regions/<id>/README.md`.
- Region = first path segment (slug, `REGION_SLUGS`); `proxy.ts` handles hub, `x-basin-region` header and redirects. Use `regionFromSlug` / `useRegion()`, and `regionPath` / `useRegionPath()` for links and API calls. No default region.
- Never fall back silently to another region's data. Per-region: pipeline configs, Mongo DB (`regionDbName`), tiles, region-named strings, `content.ts`.
- Checks the cloud session can't run go in the phase file's "Owner checks".

## Done

`npm run check` passes, new UI strings in both locales, and the relevant report/test confirms the behavior.

Next.js here has breaking changes: read the relevant guide in `node_modules/next/dist/docs/` before writing Next code.
