# DECISSIONS.md — Río Negro Basin Explorer

Dated decisions made while working through [PLAN.md](PLAN.md), with the figures and the reasons
behind them. When a choice revises an earlier one, the entry that changes it says so.
The standing architecture decisions stay in PLAN.md; data licenses are in `pipeline/SOURCES.md`.

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
- **Whole reservoirs after tuning.** I1.7 waits for I1.T so the reservoir nets use the tuned detection.
