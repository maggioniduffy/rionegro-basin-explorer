# DECISSIONS.md — Río Negro Basin Explorer

Dated decisions made while working through [PLAN.md](PLAN.md), with the figures and the reasons
behind them. When a choice revises an earlier one, the entry that changes it says so.
The standing architecture decisions stay in PLAN.md; data licenses are in `pipeline/SOURCES.md`.

## Phase E1: effluent impact (2026-10-29)

Plan approved by the owner on 2026-10-29 ([e1-effluents.md](phases/e1-effluents.md)), for the Hack to the Future
hackathon (12–13 Nov 2026).

- **User = the regulator; two demo reaches** (owner): Suquía through Bajo Grande (BOD/DO, coliforms) and the
  Cosquín/San Antonio into San Roque (TP, OECD model). Region `cba` only; nothing changes in `nqn`.
- **Forecast = GloFAS via the Open‑Meteo Flood API** (owner), scaled to each reach by the ratio to GloFAS's own
  1997–2022 reanalysis mean at the gauge cell (the API documents 1984, but these cells are null before 1997), so HydroRIVERS and GloFAS means are never mixed. Cells are hand-checked: the API
  picks "the largest river in 5 km" (a test point at -31.383, -64.12 returned 0.06 m³/s, a tributary; Centro Cívico
  snapped to -31.425, -64.175 and returned 4.5–7 m³/s, 2026-10-29). **Two gauges** (2026-10-29 probes, 2015–2020
  means): `centro-civico` cell -31.425, -64.175 (13.75 m³/s 1997–2022; HydroRIVERS 10.97) for the Suquía below the
  dam, and `san-roque-inflow` cell -31.375, -64.475 (5.01 m³/s 2015–2020, 6.40 m³/s 1997–2022; ILEC total inflow 5.25) for everything upstream of
  the dam. Per-tributary cells were rejected: GloFAS's San Antonio cells give 0.03–0.56 m³/s against 1.63 m³/s
  (ILEC), and the Cosquín cell -31.325, -64.475 gives 2.28 m³/s against 2.87.
- **No live gauge levels:** Omixom offers no public API and APRHI's portal publishes station metadata only
  (`Punto_de_medición_de_niveles` feature service). The colleague's H‑Q curves (UNC report, Aug 2026) enter as an
  optional manual "gauge level" input once they share parameters and permission.
- **Screening model, literature coefficients as ranges** (Chapra 1997; Bowie et al. 1985): kd 0.05–0.5 /d,
  coliform decay 0.5–2 /d, ka by the Covar rule, v = a·Q^m. Bajo Grande's effluent concentrations are not public, so
  the default is the permit limit (DBO₅ 40 mg/L, Decreto 847/16 + Res. APRHI 31/2022); its flow default is the
  ~2.8 m³/s design capacity (press, 2022). The DO threshold (5 mg/L) is an assumption: Córdoba sets no DO objective.
- **ML is post-hackathon (E2)**: without monitoring data it would only learn the screening model back. "When to
  discharge" is answered first by historical runs (E1.H): the response is linear in load.

## Map UI compact (2026-10-24, branch `map-ui-compact`)

- **Flow controls live in the flow panel on desktop (owner).** The 480 px floating bar ran under both side panels
  between 768 and 1280 px. On desktop the icon row (play/pause, speed, upstream/downstream, legend) sits under the
  section header and the panel's X exits flow mode; on phones it stays a floating icon bar at the top that
  collapses to a pill. The long section notes fold into a closed "Section notes" disclosure; values, the
  discharge source/period and the caveats stay visible (Rule 4).
- **One left panel with Map / Display tabs (owner).** "Visualización" leaves the right column and becomes a tab of
  the map controls panel, mirroring the phone sheet; the right column holds only the info panel, full height
  between `--panel-top` and `--panel-bottom`. `optionsOpen` left the store.
- **One map toolbar (owner).** Zoom, snapshot and, from 640 px up, sources, theme and language share one card at
  the top right; the header keeps only the wordmark and search (phones keep the header menu).
- **Delegation (owner).** `context/orchestration.md` overrides global "inline by default" orchestrator rules:
  scouts read, builders write every code change, Opus plans, reviews and commits (CLAUDE.md rule 10).

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
  Superseded by the 2026-10-24 entry below (the satellite image rules the flow view; no longer an exception
  tried after wet coverage). Evidence, limay-102: probe `wetCourseCoverage` 0.4369, `courseInWater` 0.5099; the IGN course runs on the cut-off
  northern arm while the net follows the main arm. The gate reads the published net only: no Python change, no
  `FLOWWATER_VERSION` bump, nets that pass today keep their bytes.
- **For the flow view the satellite image rules, not IGN (owner, 2026-10-24).** Owner: "for the flow the satellite
  image is rule, not IGN". Names, lines and sections still follow IGN; only what the particles follow is decided
  by the water seen in the imagery. Supersedes the WP-T1 "exception" wording. Owner answers: gate = "Ends linked
  first" (IGN wet coverage is reported per section, never required); a section without an accepted net = "IGN
  track, labelled" (the app says it is a stopgap: `flow.channel.singleTrack`). `flow-net-publish` now passes a net
  when `endsLinked` holds (reservoirs are crossed inlet to outlet at zero length) or when the reservoirs' `sRange`
  share of the course reaches `minReservoirCoverage` (0.9; renamed from `minWetCourseCoverage`); `coverageBy` is
  `endsLinked` | `reservoirs`. Cases limay-107, 109 and 111 registered (owner captures 2026-10-24: the IGN track
  ignores the main arm and crosses land).
  Local publish over 15 nets: 14 pass (limay-076 by `endsLinked`, path 2178 m of a 1998 m minimum; 077-083 and
  096 by reservoirs; 102, 107, 109, 110, 111 by `endsLinked`). **neuquen-139 is dropped** (owner, 2026-10-24:
  "Drop it for now"): its water ends in a reservoir (sRange 2168-3627 m) about 390 m before the 4013 m course
  end, with no channel or sink after it (reservoir coverage 0.364). It shows the IGN stopgap track until I1.7 or
  tuning gives it a net that reaches the end.
- **Whole reservoirs after tuning.** I1.7 waits for I1.T so the reservoir nets use the tuned detection.
