# orchestration.md — how we build PLAN.md with three models

This file says **who does what, in what order, and how we know it's done**. [PLAN.md](PLAN.md) says _what_ to
build; [DECISSIONS.md](DECISSIONS.md) records _why_; each phase file's "Owner checks" and "Follow-ups" sections
hold what only the owner can do. CLAUDE.md rules always win over this file.

## 1. Roles and model routing

| Role                | Model  | Where                               | Does                                                                                                                                                                                                                    | Never does                                                           |
| ------------------- | ------ | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| **Orchestrator**    | Opus   | Main Claude Code session            | Reads the PLAN.md index and the phase file, splits a phase into work packages (WPs) in plan mode, writes briefs, decides trade-offs, reviews diffs and reports, runs phase gates, records decisions, commits, opens PRs | Writes large feature code itself (small fixes after review are fine) |
| **Scout**           | Haiku  | `.claude/agents/scout.md`           | Large-but-simple reading: `node_modules/next/dist/docs/`, library `.d.ts`/docs, codebase sweeps ("find every X"), test/log digests, i18n key audits, PR description drafts from `git log`                               | Edits the repo; makes design decisions                               |
| **Data inspector**  | Haiku  | `.claude/agents/data-inspector.md`  | Schema, nulls, ranges, geometry of any `data/` file (a scout for data)                                                                                                                                                  | Edits; runs pipeline steps                                           |
| **License checker** | Sonnet | `.claude/agents/license-checker.md` | License / attribution text for `pipeline/SOURCES.md`                                                                                                                                                                    | Edits SOURCES.md itself                                              |
| **Builder**         | Sonnet | `.claude/agents/builder.md`         | Implements one WP per brief (app or pipeline code), adds tests only where the brief asks (§2 Tests), runs `npm run check` once at the end                                                                               | Commits, pushes, widens scope, runs heavy pipeline steps             |
| **Pipeline runner** | Sonnet | `.claude/agents/pipeline-runner.md` | Runs pipeline steps for one region, reads each `report.json`, returns a verdict                                                                                                                                         | Fixes code                                                           |
| **Reviewer**        | Opus   | `.claude/agents/reviewer.md`        | Independent check of a WP diff or a phase gate; runs the acceptance commands                                                                                                                                            | Fixes what it finds                                                  |

Rule of thumb: _if the answer is a summary, send a scout (or the data inspector); if the answer is code, send a
builder; if the answer is data, send the pipeline runner; if the answer is a decision or a verdict, Opus does it._

Sub-agents don't see the user's memory. Any memory fact a WP depends on (IGN is the authority in `nqn`; APRHI >
IGN > HydroRIVERS in `cba`; `cba` style = `nqn` style; left/right panels share `--panel-top`/`--panel-bottom`)
goes into the brief's Constraints.

## 2. The loop (one phase = one branch = one PR)

```
Opus: read CLAUDE.md + the PLAN.md index + context/phases/<id>.md + the DECISSIONS.md sections it links
  │
  ├─► scouts / data inspector (Haiku, parallel) → verify APIs, schemas, the code the phase touches → summaries
  │
Opus (plan mode): write WP briefs (template §3), order them → owner approves the plan
  │
  ├─► builder (Sonnet), one WP at a time → code (+ the few tests the brief asks for), `npm run check` green, report
  ├─► pipeline runner (Sonnet) when the WP changes data → reports read, verdict
  │
Opus: read the report + diff; small fixes inline; otherwise re-brief the builder
  ├─► reviewer (Opus) on risky WPs (§5)
  │
Opus: commit the WP ("feat(<phase>): …" / "fix(<phase>): …"), tick the phase file, add DECISSIONS.md entry and owner checks in the phase file
  │
  └─ after the last WP: phase gate (§6) → reviewer → scout drafts the PR description → Opus pushes and opens the PR
```

Rules of the loop

- **One WP in flight at a time** (CLAUDE.md Rule 12). Only read-only agents (scouts, data inspectors, license
  checker) run in parallel. Builders never run in parallel unless the owner asks; then only on disjoint file lists,
  each with `isolation: "worktree"`, and Opus merges.
- **One writer per path**: one builder per file area, one pipeline runner per `data/work/<region>/<step>/`.
- A builder report that says "deviated" or "blocked" goes back through Opus before anything else runs.
- Scout output that contradicts PLAN.md or a library assumption is written into DECISSIONS.md (dated, under the
  phase). PLAN.md keeps the goal; DECISSIONS.md wins on facts.
- Every WP ends green: `npm run check`, run once when the WP is done (CLAUDE.md requires it before a commit).
  Between rounds of the same WP, run only the touched test file (`npx vitest run <file>`) and `npm run typecheck`.
  E2E / Playwright / screenshots only when the phase gate or the owner asks (Rule 11).
- **Tests: keep them few (owner, 2026-10-13).** The app is small and the suite is already heavy.
  - Add a test only for pure logic whose bug would corrupt data or routing silently: pipeline lib functions,
    region isolation, `/api/ask` validation. One or two cases per behaviour (the main case and the edge that
    broke), not a matrix.
  - No new tests for styles, layout, copy, panels or i18n parity beyond the existing suites. For data steps,
    the step's `report.json` checks are the test.
  - Update an existing test only when the change breaks it. Don't add tests for findings a review calls minor.
  - The brief's Acceptance checks name the tests to add, if any; the builder adds no others, and the reviewer
    doesn't ask for more unless a blocking finding has none.
- Branch per phase: `phase-<id>-<slug>` (e.g. `phase-r5-cba-ugh`), PR into `main`, commits per WP. One-off fixes
  outside a phase: branch `fix-<slug>`; skip scouts and briefs when the fix is trivial, keep the review step.
- Commits follow the repo style (`feat(cba): …`, `fix: …`, `docs: …`, `chore: …`), English, small.

## 3. WP brief template (Opus → builder)

```markdown
## WP <id> — <title>

Goal: <one sentence, user-visible or report-visible outcome>
Region(s): <nqn | cba | shared> — never fall back to another region's data
Read first: CLAUDE.md · context/phases/<id>.md · context/DECISSIONS.md §<sections> · <docs in node_modules/next/dist/docs/ if Next APIs are touched>
Files (create/modify): <explicit list>; anything else = ask first
Inputs/contracts: <types, function signatures, Mongo fields, tile layer/property names, report.json checks, props>
Constraints: <CLAUDE.md rules that matter here (i18n in both locales, no invented data, modeled-data caveat with its period, MONGODB_URI server-only, idempotent steps + report.json), memory facts, libs to use/not use>
Acceptance checks:

- [ ] npm run check
- [ ] <report.json check, or the one test to add (only per §2 Tests); omit when none>
- [ ] <observable behavior>
      Out of scope: <things a builder might be tempted to do>
```

Scout briefs are one paragraph: the question, where to look, a word budget, and required citations (file:line or
URL). Data-inspector briefs name the file, the region and the columns that matter.

## 4. Owner actions (things only the owner can do)

Atlas, Vercel, Upstash, Groq, `data/raw` downloads, a real browser, and any choice between data sources. They
live in the phase file: "Owner checks" (commands and browser checks to run locally) and "Follow-ups"
(open decisions); this file does not repeat them. When a WP is blocked by one, Opus says which one, keeps the rest of
the phase moving, and stops to ask only if nothing else can run.

## 5. Reviewer triggers (risky WPs)

Send the reviewer when a WP touches any of:

- **Secrets and server boundaries**: `lib/mongo.ts`, anything reading `MONGODB_URI` or other env, a component that
  could pull server code into the client bundle.
- **`/api/ask` and the LLM path**: output validation (an invented slug must never reach the client), cache keys,
  rate limit, prompt content.
- **Region isolation and routing**: `proxy.ts`, `regions/index.ts`, `regionPath`, per-region DB names, tiles paths,
  seed — anything that could serve one region's data under another's path.
- **Data provenance**: a pipeline step's logic, `names.json`, overrides, `data/out` changes (every number traceable,
  nulls left null, reports still pass).
- **Licenses / attribution / cost**: a new source or provider, SOURCES.md, imagery, anything with recurring cost.
- Any WP the builder reported as "deviated".

## 6. Phase gate

A phase is done when the "Done when" in its phase file holds. The gate, run by Opus with the reviewer:

1. `npm run check` green on the branch.
2. Every report the phase touched read by the pipeline runner; failed checks explained or fixed.
3. i18n: scout confirms every new key exists in `en.json` and `es.json` (and in each served region's messages).
4. Reviewer verdict on the whole phase diff (`git diff main...HEAD`).
5. E2E / screenshots only if the phase is visual and the owner asks; otherwise listed in the phase file's owner checks.
6. Phase file ticked and its PLAN.md row updated, DECISSIONS.md entry written, owner checks listed, PR opened.

## 7. Session kickoff prompt (paste at the start of each phase)

```
Phase <id>. You are the orchestrator (Opus). Read CLAUDE.md, context/orchestration.md §1–3 and §5–6,
the context/PLAN.md index, context/phases/<id>.md (only that phase), and the DECISSIONS.md sections it links.
1. Send scouts / data inspectors for anything the phase needs verified that DECISSIONS.md doesn't cover.
2. In plan mode, write the WP briefs with the template and get my approval.
3. Run builders WP by WP; pipeline runner for data WPs; reviewer for §5 WPs; commit per WP.
4. Run the phase gate, have a scout draft the PR description, push phase-<id>-<slug> and open a PR.
Stop and ask me only for owner actions (the phase file's owner checks) or a decision that changes PLAN.md.
```

## 8. Carried-over findings

Non-blocking findings from reviews and gates. Each names the WP or phase where it lands; remove the row once fixed.

| Finding                                                                                                                                                                                                                                                                             | Found in        | Fix in                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------- |
| A HydroRIVERS fill route that is mostly straight connector (e.g. Tercero `fill:hr:52`, 4.24 of 5.04 km) is labelled "Modeled path (HydroRIVERS)" in the line panel; label by connector share or set a route-vs-connector threshold in `river-lines`                                 | R5 gate         | next cba phase            |
| Two switches for course fill in `cba`: `COURSE_FILL` in `lib/map/config.ts` and export's `river-lines.config.json` check can drift; one flag in the region registry                                                                                                                 | R5 gate         | next cba phase            |
| Tercero's sample length went from 274.8 to 374.9 km with the mapped course (APRHI lines more sinuous than the 15″ path); confirm against own-named APRHI km in `river-lines/report.json`                                                                                            | R5 gate         | next cba phase            |
| Course pieces that matched a lower-order reach than the course around them (Quinto `aprhi:3996:0#23`, Dulce `aprhi:747:*`) start at z9 with the fill beside them; a display rank that never drops downstream along a course (`course.parquet` order) would close the low-zoom holes | R5 gate         | next cba phase            |
| Flow panel shows the raw discharge source ("HydroRIVERS v1.0 DIS_AV_CMS"); a friendlier label by source from i18n                                                                                                                                                                   | F1 gate         | next flow phase           |
| Flow mode: clicking the section's own river near it refits the camera each time; clicking empty map exits flow; confirm with the owner after the browser pass                                                                                                                       | F1 gate         | after the F1 browser pass |
| Flow fit doesn't pad for the control bar, so the section's downstream end can sit under it                                                                                                                                                                                          | F1 e2e baseline | next flow phase           |
