# DECISSIONS.md — Río Negro Basin Explorer

Dated decisions made while working through [PLAN.md](PLAN.md), with the figures and the reasons
behind them. When a choice revises an earlier one, the entry that changes it says so.
The standing architecture decisions stay in PLAN.md; data licenses are in `pipeline/SOURCES.md`.

## Phase I1 (2026-10-19)

- **I1 and B1 merged (owner).** B1 closes with B1.1–B1.3 and the untrack done. Its leftovers move into I1: the
  Vercel CDN cache (B1.5 → I1.6) and whole reservoirs (B1.4 → I1.7). Both old phase files are replaced by
  [`i1-imagery-water.md`](phases/i1-imagery-water.md); their history stays in git and in "Phase B1" below.
- **Water probe before tuning.** Refining the detector in hard places (braided reaches, reservoirs) needs to see
  each stage on a small box in seconds, so a `flow-water probe` (I1.P) comes first. It reuses the pipeline's
  acquisition and per-look indices, so pipeline output stays byte-identical (no `FLOWWATER_VERSION` bump).
- **Tuning method: measured human-in-the-loop calibration**, not reinforcement learning. 2–3 owner cases with
  truth polygons; the probe's `--search` ranks config variants by IoU / FP / FN / missed branches; no change is
  kept that lowers IoU on another case; cases stay as regression checks.
- **Search runs in the probe, not in a model.** Codex-backed agents (pipeline-runner, data-inspector) run probes
  and return metric tables; Opus reads tables and picks the next hypothesis; the owner looks at the images.
- **Publish gate accepts a net whose main arm links the section's ends (owner, 2026-10-23).** Owner: "when the
  detected net links the section's ends along the main arm, accept it even if the IGN course leaves the water."
  `flow-net-publish` still checks wet/reservoir coverage first; if that fails, `endsLinked` (`pipeline/lib/net-gate.ts`)
  passes a net with a directed source-to-sink path within 150 m of both course ends, widest bottleneck, connector
  share <= 0.1, length >= 0.5 of the course and `insideWater` >= 0.95 (provisional; 150 m = 2 x `cover_tol_m`).
  Exception to "IGN is the authority" for the flow view only: names, lines and sections still follow IGN.
  Evidence, limay-102: probe `wetCourseCoverage` 0.4369, `courseInWater` 0.5099; the IGN course runs on the cut-off
  northern arm while the net follows the main arm. The gate reads the published net only: no Python change, no
  `FLOWWATER_VERSION` bump, nets that pass today keep their bytes.
- **Whole reservoirs after tuning.** I1.7 waits for I1.T so the reservoir nets use the tuned detection.
