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
- `/.claude` — `agents/` and `skills/` (committed)

## Rules

1. **Language:** code, comments, commit messages, docs and identifiers in English. **All user-facing strings go through i18n** (`/messages/en.json` and `es.json`); never hardcode UI text. River and place names are proper nouns and are not translated.
2. **No invented data.** Every derived number must be traceable to a source field (HydroRIVERS, HydroATLAS, HydroBASINS, IGN, OSM). If a value can't be sourced, leave it null and say so. Never guess attribute names — inspect the actual schema first.
3. **Flag uncertainty** instead of overstating. When something can't be verified (a license, a data quality claim, a library API), say so and propose how to check it.
4. **Modeled data caveat:** HydroATLAS values are modeled or estimated, each for its own period: discharge is a natural long-term average for 1971–2000 that doesn't reflect current dam regulation; population is a 2010 estimate (GPWv4); flooded area comes from 1993–2004 satellite data (GIEMS-D15); dam regulation comes from GRanD v1.1 dams. The UI must state this, with the right period, wherever those values appear.
5. **Never commit** `data/raw`, `data/work`, secrets, or `.env*`. Keep `MONGODB_URI` server-side only.
6. **Keep context small:** never `cat` large geo files. Use `head`, `jq`, or DuckDB summary queries. Heavy processing happens in pipeline scripts, not in the conversation.
7. **Pipeline steps must be idempotent** and write a `report.json` (counts, total km, orphan segments, area checks). Read the report to verify results instead of judging by eye.
8. **Cost-conscious:** prefer free tiers (Atlas M0, Vercel hobby, PMTiles over tile servers). Flag anything that could add recurring cost.
9. **Licenses and attribution:** keep `/pipeline/SOURCES.md` updated (source, URL, license, required citation, download date). Check the license before adding any new data source or imagery provider.
10. **Workflow:** work one phase at a time from `PLAN.md`, in plan mode first. Small commits. Update the checklist when a phase's "Done when" criteria are met.
11. Dismiss visual tests unless called for

## Sub-agents, skills and background work

### Sub-agents (parallel work, small main context)

- Delegate long-running or output-heavy work to sub-agents: dataset inspection and profiling (DuckDB summaries), running pipeline steps and reading their `report.json`, test/log triage, license and source lookups, codebase exploration. The main thread gets back a short summary (counts, paths, verdict, open questions), never raw rows or geometries.
- Run independent tasks in parallel (e.g. one sub-agent per source: HydroRIVERS, IGN, OSM). Do not parallelize steps that depend on each other's output (pipeline steps run in order) or that write to the same path.
- One writer per path: only one agent writes to a given `data/work/<step>/`. Inspection agents are read-only.
- Sub-agents follow the same Rules above (no invented data, flag uncertainty, never commit data or secrets).
- Define reusable sub-agents in `.claude/agents/<name>.md` (Markdown with YAML frontmatter: `description`, `tools`, `model`). Grant only the tools needed. Use a cheaper model for inspection and lookups; keep the main model for design and decisions (Rule 8). Verify current model aliases and frontmatter fields in the Claude Code docs before writing them.
- Initial candidates: `data-inspector` (schema + summary stats, read-only), `pipeline-runner` (run a step, read the report, summarize), `license-checker` (license/citation lookup for `SOURCES.md`).

### Skills (repeatable procedures)

- If a task has been done by hand twice, or is clearly recurring, stop and propose a skill; create it once the user agrees, to avoid skill sprawl. Never create skills for one-offs.
- Skills live in `.claude/skills/<name>/SKILL.md` with a `description` that says when to use it. Keep them short: the procedure, the commands, the checks and the expected report shape. Put logic in pipeline scripts, not in prose.
- Candidates: `inspect-dataset` (schema and DuckDB summary without dumping rows), `run-pipeline-step`, `update-sources` (append to `SOURCES.md`), `add-ui-string` (same key in both locales), `screenshot-check`.
- Commit `.claude/agents/` and `.claude/skills/`.

### Long-running commands

- Run heavy commands (tippecanoe, large DuckDB or ogr2ogr jobs) in the background, redirect output to `data/work/<step>/*.log`, and poll with `tail` or the step's `report.json`. Never stream full logs into the conversation.
- Before starting a long job, state what it will produce and how completion will be verified.

## Definition of done (any change)

`npm run check` passes, new UI strings exist in both locales, and the relevant report or screenshot test confirms the behavior.

## Next.js version notes

@AGENTS.md
