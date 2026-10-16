# CLAUDE.md — Río Negro Basin Explorer

Interactive satellite river-and-tributary explorer for the Río Negro basin
(Limay, Neuquén, Río Negro), with a sub-basin (subcuenca) view. Inspired by
Amazon Basin Explorer. One app serves several **regions**, one per path (`/rionegro`, `/cordoba`): `nqn` (the Río
Negro basin, live) and `cba` (Córdoba, served since R3.8); see "Regions" below. See `context/PLAN.md` for open phases and status (completed phases are in `context/PLAN_ARCHIVE.md`; read it only when you need their history), and `context/DECISSIONS.md` for the dated
decisions made in each phase (read it before revisiting a choice; add new decisions there, not in `context/PLAN.md`).

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
- `npm run pipeline:<step> -- --region <id>` — data pipeline steps for one region; `--region` is required (`nqn` = Río Negro; see `/pipeline/README.md`)
- `npm run seed -- --region <id>` — idempotent Mongo seed from `data/out/<region>/`
- `npm run test:e2e` — Playwright screenshot tests

## Repo layout

- `/app/[region]` pages + `/api/*` route handlers, the param being the region's URL slug (`/cordoba/map`, `/cordoba/api/search`; see `regions/`); `/app/hub` is the hub at `/`
- `/regions` — registry (`index.ts`, `hosts.ts`) and one folder per region: pipeline configs, `messages/`, `content.ts`, generated landing/OG files
- `/components`, `/lib` (mongo.ts, map/, store.ts, units.ts), `/messages` (shared en.json, es.json), `/i18n` (merges shared + region messages)
- `/pipeline` TS scripts orchestrating DuckDB / GDAL / tippecanoe; each step writes to `data/work/<region>/` and emits a report
- `/data` — `raw/` (shared) and `work/<region>/` are gitignored; `out/<region>/` holds NDJSON for the seed; tiles are in `public/tiles/<region>/`
- `/.claude` — `agents/` and `skills/` (committed)

## Rules

1. **Language:** code, comments, commit messages, docs and identifiers in English. **All user-facing strings go through i18n** (`/messages/en.json` and `es.json`, or `regions/<id>/messages/` for strings that name a region); never hardcode UI text. River and place names are proper nouns and are not translated.
2. **No invented data.** Every derived number must be traceable to a source field (HydroRIVERS, HydroATLAS, HydroBASINS, IGN, OSM). If a value can't be sourced, leave it null and say so. Never guess attribute names — inspect the actual schema first.
3. **Flag uncertainty** instead of overstating. When something can't be verified (a license, a data quality claim, a library API), say so and propose how to check it.
4. **Modeled data caveat:** HydroATLAS values are modeled or estimated, each for its own period: discharge is a natural long-term average for 1971–2000 that doesn't reflect current dam regulation; population is a 2010 estimate (GPWv4); flooded area comes from 1993–2004 satellite data (GIEMS-D15); dam regulation comes from GRanD v1.1 dams. The UI must state this, with the right period, wherever those values appear.
5. **Never commit** `data/raw`, `data/work`, secrets, or `.env*`. Keep `MONGODB_URI` server-side only.
6. **Keep context small:** never `cat` large geo files. Use `head`, `jq`, or DuckDB summary queries. Heavy processing happens in pipeline scripts, not in the conversation.
7. **Pipeline steps must be idempotent** and write a `report.json` (counts, total km, orphan segments, area checks). Read the report to verify results instead of judging by eye.
8. **Cost-conscious:** prefer free tiers (Atlas M0, Vercel hobby, PMTiles over tile servers). Flag anything that could add recurring cost.
9. **Licenses and attribution:** keep `/pipeline/SOURCES.md` updated (source, URL, license, required citation, download date). Check the license before adding any new data source or imagery provider.
10. **Workflow:** work one phase at a time from `context/PLAN.md`, in plan mode first, following `context/orchestration.md` (Opus orchestrates and reviews, Haiku scouts read, Sonnet builders code; one branch and PR per phase, one commit per work package). Small commits. Update the checklist when a phase's "Done when" criteria are met, and record the phase's decisions in `context/DECISSIONS.md`.
11. Dismiss visual and chromium tests unless called for
12. Always start tasks in PLAN MODE

## Regions

- **Known vs served.** `regions/index.ts`: `KNOWN_REGION_IDS` is what `--region` accepts (pipeline, seed, scripts); `REGION_IDS` is what the app serves. A known but unserved region's path gets 404. To serve a region, follow its `regions/<id>/README.md`; adding the id to `REGION_IDS` makes TypeScript list every per-region record still missing.
- **Routing.** The region is the first path segment, its slug (`regions/index.ts` `REGION_SLUGS`: `rionegro`, `cordoba`), which is the `app/[region]` param; ids stay internal. `proxy.ts` serves the hub at `/`, sets the `x-basin-region` header on region paths, redirects id paths (`/cba/…`) and the old per-region hosts (`regions/hosts.ts`) to the slug path. Server code gets the region from route params (`regionFromSlug`, or the header in `i18n/request.ts`); client code from `useRegion()`. Links and API calls go through `regionPath` / `useRegionPath()` (`useApi` adds it). No default region for a URL: an unknown path is a 404.
- **Per region:** pipeline configs and `--region` (required), Mongo database (`regionDbName`: `nqn` keeps `basin-explorer`, others append `-<id>`), tiles (`public/tiles/<id>/`, versioned per region), UI strings that name the region, `content.ts` (featured rivers, landing sample picks, OG subtitle, ask prompt place and examples). Everything else is shared.
- **Never** let a region's code path fall back to another region's data silently: no default region in pipeline commands, and tests check that every served region defines the same message keys and valid prompt slugs.
- Local checks the cloud session can't run (pipeline on `data/raw`, Atlas, Vercel, a browser) go in `context/RUN_LOCAL.md` after each change.

## Sub-agents, skills and background work

### Sub-agents (parallel work, small main context)

- Delegate long-running or output-heavy work to sub-agents: dataset inspection and profiling (DuckDB summaries), running pipeline steps and reading their `report.json`, test/log triage, license and source lookups, codebase exploration. The main thread gets back a short summary (counts, paths, verdict, open questions), never raw rows or geometries.
- Run independent tasks in parallel (e.g. one sub-agent per source: HydroRIVERS, IGN, OSM). Do not parallelize steps that depend on each other's output (pipeline steps run in order) or that write to the same path.
- One writer per path: only one agent writes to a given `data/work/<region>/<step>/`. Inspection agents are read-only.
- Sub-agents follow the same Rules above (no invented data, flag uncertainty, never commit data or secrets).
- Define reusable sub-agents in `.claude/agents/<name>.md` (Markdown with YAML frontmatter: `description`, `tools`, `model`). Grant only the tools needed. Use a cheaper model for inspection and lookups; keep the main model for design and decisions (Rule 8). Verify current model aliases and frontmatter fields in the Claude Code docs before writing them.
- Agents: `scout` (Haiku, read and summarize docs/code/logs), `builder` (Sonnet, implements one work package), `reviewer` (Opus, independent verdict on a diff or phase gate), `data-inspector` (schema + summary stats, read-only), `pipeline-runner` (run a step, read the report, summarize), `license-checker` (license/citation lookup for `SOURCES.md`). Roles, brief template and reviewer triggers are in `context/orchestration.md`.

### Skills (repeatable procedures)

- If a task has been done by hand twice, or is clearly recurring, stop and propose a skill; create it once the user agrees, to avoid skill sprawl. Never create skills for one-offs.
- Skills live in `.claude/skills/<name>/SKILL.md` with a `description` that says when to use it. Keep them short: the procedure, the commands, the checks and the expected report shape. Put logic in pipeline scripts, not in prose.
- Candidates: `inspect-dataset` (schema and DuckDB summary without dumping rows), `run-pipeline-step`, `update-sources` (append to `SOURCES.md`), `add-ui-string` (same key in both locales), `screenshot-check`.
- Commit `.claude/agents/` and `.claude/skills/`.

### Long-running commands

- Run heavy commands (tippecanoe, large DuckDB or ogr2ogr jobs) in the background, redirect output to `data/work/<region>/<step>/*.log`, and poll with `tail` or the step's `report.json`. Never stream full logs into the conversation.
- Before starting a long job, state what it will produce and how completion will be verified.

## Definition of done (any change)

`npm run check` passes, new UI strings exist in both locales, and the relevant report or screenshot test confirms the behavior.

## Next.js version notes

@AGENTS.md
