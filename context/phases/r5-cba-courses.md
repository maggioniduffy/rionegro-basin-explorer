<!-- Phase file. Index and status: [PLAN.md](../PLAN.md). -->

# Phase R5 — Continuous river courses in Córdoba (`cba`)

Plan approved 2026-10-13 ([DECISSIONS.md](../DECISSIONS.md#córdoba-r5-continuous-river-courses-2026-10-13)): each of the 13 rivers is drawn as one course from source to mouth along the mapped lines; gaps filled with IGN, then HydroRIVERS (dashed); other-named and unnamed pieces on the course keep their source name; river length = mapped course length. Branch `phase-r5-cba-courses`.

- [x] R5.0 Measurements (APRHI/IGN classes, lines near each hole, endpoint snap distances) — in DECISSIONS.md (2026-10-13)
- [x] R5.1 `pipeline:river-lines`: course per river from the display lines (graph, Dijkstra bridges, anchors, extensions, attach, arms, confluence cuts) and `report.json` — 13 courses, all checks ok, two runs identical; own share with arms ≥ 0.95 except the Segundo (0.943, eastern arm out on purpose); Salí and Cuarto don't reach their receiver yet (2026-10-13)
- [x] R5.2 Gap fill: IGN raw lines (also inside the province, only in gaps), then HydroRIVERS geometry; `fill.parquet` — 85 fills (IGN 42.6 km, HydroRIVERS 112.6 km, straight connectors 30.2 km), no gap left, Salí and Cuarto reach their receivers, one component per river (2026-10-13)
- [x] R5.3 Export and tiles: `river` from the course, fill pieces, `lengthKm` from the mapped course with per-source km; `nqn` byte-identical (2026-10-13)
- [x] R5.4 Map, panel, legend and i18n (HydroRIVERS fill dashed, "name in the source") (2026-10-13)
- [x] R5.5 Run and gate: receiver extension limited to the receiver; reports ok, two runs identical, `nqn` byte-identical, 615 tests; Segundo own share 0.943 accepted (owner's Plujunta choice, DECISSIONS.md) (2026-10-13)
- **Done when:** all 13 rivers have a one-component course from source to mouth; every filled km names its source; ≥ 95 % of each river's own-named km are in its course (with arms); Primero, Jesús María and Dulce reach Mar Chiquita where their line does; the Quinto is drawn without breaks; reports ok, two runs identical, `nqn` byte-identical; `npm run check` green and new strings in EN and ES.

## Plan and resume notes (was R5_PLAN.md)

Approved by the owner on 2026-10-13. Status checklist: the checklist above.
Decisions and measurements: [DECISSIONS.md](../DECISSIONS.md#córdoba-r5-continuous-river-courses-2026-10-13).
Workflow: [orchestration.md](../orchestration.md) (Opus orchestrates; builder, then pipeline-runner, then reviewer;
one commit per WP; at most 2 sub-agents at once; DuckDB `memory_limit` 2GB, `threads` 2; few tests, see §2).

### Status

- Done: WP 5.0–5.5 (5.5a fixed the gate findings), merged into `main`. Owner steps are in RUN_LOCAL.md "R5".
- Keep `Screencast-from-13-10-26-16_07_18.gif` out of every commit.

### Goal

Each of the 13 rivers in `regions/cba/names.json` is drawn as one continuous course from source to mouth. The
course follows the mapped lines (APRHI inside the province, IGN outside). Gaps are filled by precedence: IGN
first, then HydroRIVERS. `nqn` does not change. Streams are out of scope.

**Owner decisions:**

- **Gap fill.** Use IGN first. That includes raw IGN inside the province, but only in gaps, which is an exception
  to R3.3. Where there is no IGN, use the HydroRIVERS path, drawn dashed, with a legend note.
- **Pieces on the channel.** Other-named and unnamed pieces that follow the channel belong to the river. They
  keep their source name in the panel.
- **River length.** The length of the mapped course (APRHI + IGN + HydroRIVERS in the gaps), with the source
  stated. HydroATLAS values still come from the reaches.

### Work packages

| WP  | Agent                            | Then                                                                               |
| --- | -------------------------------- | ---------------------------------------------------------------------------------- |
| 5.2 | builder                          | pipeline-runner `river-lines` cba (twice), then reviewer, then commit              |
| 5.3 | builder                          | pipeline-runner `export` and `tiles` cba, `export` nqn, then reviewer, then commit |
| 5.4 | builder                          | scout checks the EN/ES keys, Opus reviews the diff, then commit                    |
| 5.5 | pipeline-runner, reviewer, scout | gate, then PLAN, DECISSIONS and RUN_LOCAL, then PR                                 |

### WP 5.2 — gap fill (second stage of `river-lines`)

- **IGN first.** For each `path` gap in `gaps.json`, look for raw IGN lines in the gap's corridor, including
  lines inside the province, that join the gap's two ends.
  - Read IGN with the reader at `pipeline/steps/lines.ts:234-239`, moved into `pipeline/lib/`.
- **HydroRIVERS next.** Where IGN does not close the gap, use the geometry of the course's HydroRIVERS reaches,
  cut at the points nearest the gap's ends.
- **Fill pieces.**
  - Same schema as the other pieces. `pieceId` is `fill:ign:…` or `fill:hr:…`.
  - `src` is `ign` or `hydrorivers`, and `fill = true`.
  - Written to `river-lines/fill.parquet`.
- **Report.** Filled km per source and per river. A check that no river has a gap left.
- **Also close `receiverNotReached`.** The Salí's course ends 11.9 km from the Dulce's, and the Cuarto's
  24.9 km from the Saladillo's. Check whether the Cuarto's 39.8 km arm is its real lower course.
- **Leave `lines.ts` alone.** `noIgnPieceInsideProvince` stays as it is; the fill lives in another file.
- Quinto: the hole in San Luis has no line within 5 km, so it needs HydroRIVERS. The southern hole has 44 km of
  raw IGN within 5 km.

### WP 5.3 — export and tiles

- In `export.ts`:
  - A piece's `river` comes from `course.parquet` first, otherwise from its reach.
  - Fill pieces are added with `src` and `fill`.
  - `lengthKm` is the length of the mapped course. Its provenance gives the km from APRHI, IGN and HydroRIVERS.
  - HydroATLAS values do not change.
- `tiles.ts` keeps the `fill` property.
- Check: the `nqn` outputs stay byte-identical. The step runs only when the region has a config; nothing is
  inferred from which files exist.

### WP 5.4 — map and i18n

- In `lib/map/style.ts`:
  - HydroRIVERS fill is dashed.
  - IGN fill uses the normal style, with its flow class.
  - A piece with a `river` but no reach uses the river style.
- The highlight already filters on `river`, so it does not change.
- Panel: a piece with another name shows the river, and under it "name in the source: …".
- Legend: "Modeled path (HydroRIVERS), no mapped channel", plus the note on where the length comes from. Both in
  EN and ES, in `regions/cba/messages/`.
- Tests: only the minimum (§2 Tests).

### WP 5.5 — run and gate

- The pipeline-runner runs `river-lines`, `export` and `tiles` for `cba`, then `export` for `nqn`, and checks
  that `nqn` has no diff.
- Gate (§6):
  - `npm run check`
  - reviewer verdict on `git diff main...HEAD`
  - scout checks the i18n keys
- Update PLAN, DECISSIONS and RUN_LOCAL. The owner's local steps go in RUN_LOCAL: seed `basin-explorer-cba`, and
  look at the Quinto, Primero, Jesús María, Segundo and Dulce in the browser.
- Open the PR.

### Done when

- All 13 rivers have a course of one component, from source to mouth.
- Every filled km names its source.
- At least 95 % of each river's own-named km are in its course, arms included.
- Primero, Jesús María and Dulce reach Mar Chiquita where their line does.
- The Quinto is drawn without breaks.
- Reports are ok, two runs are identical, and `nqn` is byte-identical.
- `npm run check` passes, and every new string exists in EN and ES.
