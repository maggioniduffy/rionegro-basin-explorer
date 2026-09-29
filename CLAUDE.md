# CLAUDE.md — Río Negro Basin Explorer

Interactive satellite river-and-tributary explorer for the Río Negro basin
(Limay, Neuquén, Río Negro), with a sub-basin (subcuenca) view. Inspired by
Amazon Basin Explorer. See `PLAN.md` for phases and status.

## Stack

- Next.js (App Router) + React + TypeScript (strict) + Tailwind CSS
- MongoDB (Atlas) accessed **only** from Server Components and Route Handlers. No separate backend.
- MapLibre GL JS + PMTiles for geometry (geometry does NOT live in Mongo)
- Zustand for client state, synced with URL query params
- next-intl for i18n (EN + ES from day one)
- Package manager: npm (commit `package-lock.json`; use `npm ci` in CI)
- Deploy: Vercel

## Commands

- `npm run dev` — dev server
- `npm run check` — typecheck + lint + tests (run before every commit)
- `npm run pipeline:<step>` — data pipeline steps (see `/pipeline/README.md`)
- `npm run seed` — idempotent Mongo seed from `data/out/`
- `npm run test:e2e` — Playwright screenshot tests

## Repo layout

- `/app` pages + `/api/*` route handlers
- `/components`, `/lib` (mongo.ts, map/, store.ts, units.ts), `/messages` (en.json, es.json)
- `/pipeline` TS scripts orchestrating DuckDB / GDAL / tippecanoe; each step writes to `data/work/` and emits a report
- `/data` — `raw/` and `work/` are gitignored; `out/` holds tiles and NDJSON for the seed

## Rules

1. **Language:** code, comments, commit messages, docs and identifiers in English. **All user-facing strings go through i18n** (`/messages/en.json` and `es.json`); never hardcode UI text. River and place names are proper nouns and are not translated.
2. **No invented data.** Every derived number must be traceable to a source field (HydroRIVERS, HydroATLAS, HydroBASINS, IGN, OSM). If a value can't be sourced, leave it null and say so. Never guess attribute names — inspect the actual schema first.
3. **Flag uncertainty** instead of overstating. When something can't be verified (a license, a data quality claim, a library API), say so and propose how to check it.
4. **Modeled data caveat:** HydroATLAS discharge/population are modeled long-term averages (1971–2000) and don't reflect current dam regulation. The UI must state this wherever those values appear.
5. **Never commit** `data/raw`, `data/work`, secrets, or `.env*`. Keep `MONGODB_URI` server-side only.
6. **Keep context small:** never `cat` large geo files. Use `head`, `jq`, or DuckDB summary queries. Heavy processing happens in pipeline scripts, not in the conversation.
7. **Pipeline steps must be idempotent** and write a `report.json` (counts, total km, orphan segments, area checks). Read the report to verify results instead of judging by eye.
8. **Cost-conscious:** prefer free tiers (Atlas M0, Vercel hobby, PMTiles over tile servers). Flag anything that could add recurring cost.
9. **Licenses and attribution:** keep `/pipeline/SOURCES.md` updated (source, URL, license, required citation, download date). Check the license before adding any new data source or imagery provider.
10. **Workflow:** work one phase at a time from `PLAN.md`, in plan mode first. Small commits. Update the checklist when a phase's "Done when" criteria are met.

## Definition of done (any change)

`npm run check` passes, new UI strings exist in both locales, and the relevant report or screenshot test confirms the behavior.

## Next.js version notes

@AGENTS.md
