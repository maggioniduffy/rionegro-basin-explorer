<!-- Phase file. Index: [i1-imagery-water.md](../i1-imagery-water.md) · Plan: [PLAN.md](../../PLAN.md) -->

# I1.T — Tuning loop with the owner

- [ ] **I1.T Tuning loop with the owner** (Opus + owner, data).
  1. Owner sends 2–3 hard captures + map URL (or coords). Each becomes a case.
  2. Truth: owner marks corrections (polygon or "missed arm here / false water here"); traced only on imagery whose
     license allows it (I1.0), else on Sentinel-2/EOX.
  3. Loop: probe → HTML (artifact) → owner feedback → change config or algorithm → probe all cases. Each round
     records metrics per case in the case's report; no change kept that lowers IoU on another case.
  4. Result: new `flow-water.config.json` values and/or algorithm changes (with `FLOWWATER_VERSION` bump),
     DECISSIONS.md entry with the before/after table. Rerun affected sections remotely (B1.2 workflow).

  Not reinforcement learning: a measured human-in-the-loop calibration; cases stay as regression checks.

  **Second track: flow decisions (planned 2026-10-21, implement after the mask track works).** Besides the water
  mask, the loop scores _decisions_: which arm carries flow and in which direction (`network.py`, `flow-net/1`).
  Same registry, same probe, same report; no separate eval script or case file.
  - **Cases.** `regions/nqn/flow-water.cases.json` entries gain an optional
    `decisions: [{arm, correctDecision, errorType, correctedAt, split}]` next to `truth`. A reach is a flow section
    id (`limay-076`, from `public/flow/nqn/index.json`); `arm` is a stable branch key (section id + branch start/end
    chainage `s[2]`; local `b0..` ids change between runs). `errorType` in braided, flat, confluence, reservoir,
    anabranch, control. Sample by type; no reach ids in the algorithm.
  - **Split.** `dev` | `holdout` applies to decisions only, fixed by a deterministic hash and never moved; holdout is
    reported, not tuned on. Mask cases (2–3 captures) are all `dev`; revisit if more are added.
  - **D1 Schema and merge.** Validator and a never-overwrite merge (an existing `reachId`+`arm` is kept, conflicts
    are reported).
  - **D2 Branch features.** Additive per-branch `confidence` and `features` in `flow-net/1` (angle, Strahler via
    HYRIV match or null, width, DEM slope, distance to main channel). No model is trained; ML only when hundreds of
    corrections exist and rules conflict (then propose and wait for approval).
  - **D3 Scoring.** The probe reports % correct overall / per errorType / per split next to IoU, deterministic, in
    the case's `report.json`; non-zero exit when a previously correct decision turns wrong; `n=0` with no labels.
  - **D4 Review mode.** The probe HTML gets a mode listing candidate arms with proposed flow, lowest confidence
    first; the owner marks correct/incorrect plus error type; export merges without overwriting.
  - **D5 Label-free checks.** Cycles, outlet reachability and flow conservation at confluences, listed for
    unreviewed sections. Only sections with a net (11 of 910 today). Useful for I1.7: El Chocón is a reservoir case.
  - **D6 Docs.** `pipeline/README.md`, DECISSIONS.md. Python changes need `uv run pytest` (not in `npm run check`).

  **Agent split to save tokens and load (owner, 2026-10-19):**
  - **Search is done by the probe, not by a model.** `--search key=a..b:step,...` runs a grid (or small random)
    search over config values on every case with truth, scored by IoU / FP / FN / missed branches, and writes a
    ranked `search.json` (top-N + per-case metrics). Bands are cached, so a search of tens of variants is CPU only.
  - **pipeline-runner** (Codex wrapper) runs probes and searches, reads `report.json` / `search.json`, and returns a
    ≤20-line table (variant, per-case IoU, FP, FN, regressions). It never pastes images or arrays. Max 2 agents at
    once (owner rule), and one writer per case dir.
  - **data-inspector** (Codex wrapper) answers cheap questions about a case's arrays (e.g. MNDWI histogram inside
    the owner's "missed arm" polygon) with DuckDB/numpy summaries.
  - **builder (Sonnet)** implements algorithm changes (new rule, new index) when a config change isn't enough.
  - **Opus** only reads the tables, picks the next hypothesis and decides what to keep. **The owner looks at the
    images** (HTML artifact); Opus looks at a stage PNG only when a table can't explain a failure.
  - Each round = one brief to the runner: cases, search space, metric to optimise, regression bound.
  - Possible later: a dedicated Codex agent for algorithm iteration under Opus control (owner, 2026-10-19), to be
    designed once I1.P is done.

  **Cases (2026-10-23).**
  - Case 1: `limay-102`, registered in `regions/nqn/flow-water.cases.json` with a main-arm truth line
    (`flow-water-cases/limay-102.truth.geojson`). The particles followed a cut-off arm because the section has no
    published net (the detector finds the main arm, but wet coverage 0.44 < 0.9 rejected it).
  - WP-T1: `flow-net-publish` also passes a net that links the section's ends along the main arm
    (`endsLinked`, DECISSIONS 2026-10-23). Check: `pipeline:flow-water --only limay-102` then `flow-net-publish`;
    the report must show `coverageBy: "endsLinked"` for limay-102.

  **Owner checks (WP-T1).**
  - View limay-102 in flow mode locally after a run and confirm the particles follow the main arm.
  - Approve a remote run (B1.2 dispatch) of the Limay sections without nets before it is dispatched.
