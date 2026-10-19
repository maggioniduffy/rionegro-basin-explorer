<!-- Phase file. Index and status: [PLAN.md](../PLAN.md). -->

# Phase F3 — Flow engine on the water network (`nqn`)

Plan approved 2026-10-18 ([DECISSIONS.md](../DECISSIONS.md#phase-f3-flow-engine-on-the-water-network-2026-10-18)).
Branch `phase-f3-flow-network`.

F1 moves particles along one IGN track per section: braided arms are lost, reservoirs are not flowable (58
sections) and dam gaps look dry. F2 built `flow-net/1` (branches with junctions and illustrative shares, reservoir
polygons with ports and drift) for 4 sections, unpublished. F3 lands the F2 follow-ups, runs the step in resumable
batches, publishes a compact net per section, and teaches the engine hand-off at junctions, slow 2D drift in
reservoirs, and fallback to the F1 track when a section has no net.

## Owner decisions (2026-10-18)

- **No full run.** The step runs in resumable batches; batch 1 is El Chocón and Arroyito only
  (`limay-076..limay-102`, 27 sections). Later batches are owner commands (below).
- **Reservoir sections become viewable** when a net that passes QA exists for them (slow 2D drift); without a
  net they stay not flowable, as in F1.
- **Budget.** The 8 MB cap was a round number in the F1 plan, not an external limit (see DECISSIONS). Sections
  keep ≤ 8 MB; nets get their own ≤ 4 MB.

## Design summary

- **Batches.** `--only` takes ids and ranges (`limay-076..limay-102`), `--rivers limay`; a section whose net is
  up to date (config and scene-lock hash) is skipped, `--force` redoes it; writes are atomic; per-section reports
  in `out/<id>.report.json` and `report.json` rebuilt from all of them.
- **Publish.** `npm run pipeline:flow-net-publish -- --region nqn` validates each `flow-net/1`, applies a QA gate
  (fail → F1 fallback with a reason) and writes `public/flow/nqn/<id>.net.json` (`flow-net-pub/1`: integer metres
  from the bbox SW corner, delta-encoded) plus `nets.json` (`{ids, reservoirSections}`), flat beside the
  sections, so the build-time content hash covers them.
- **Engine.** One `Track` per branch on a shared origin; particles carry a branch or reservoir mode; at a branch
  end they pick an out-branch by share (seeded PRNG), drift slowly inside a reservoir along its drift vector and
  leave through an outlet by share. Speed in a branch is (1 − |u|⁴) × flux / W(s), normalised to the network
  maximum; illustrative like F1. The F1 functions are unchanged, so a section without a net renders exactly as
  before.

## Work packages

- [x] F3.0 Phase file, PLAN row, DECISSIONS entry, GLO-30 licence read (SOURCES.md)
- [ ] F3.1 flow-water: batches and resume, connectors before dead-end pruning, reservoir hub in/out, drift
      convergence, SCL class 2 measurement; pytest: 3 cases
- [ ] F3.2 `pipeline:flow-net-publish` (QA gate, `flow-net-pub/1`, `nets.json`, 4 MB budget, report); vitest:
      round trip
- [ ] F3.3 `lib/flow/network.ts`, net particles (hand-off, reservoir drift), branch speed; tests: shares, bounds
- [ ] F3.4 Loading (`nets.json`, nets), FlowController and layer (shared origin, cached uniforms), flowability of
      reservoir sections
- [ ] F3.5 FlowPanel / legend copy (network vs single track, reservoir drift, illustrative shares), attribution;
      EN/ES
- [ ] F3.6 Batch 1 run and publish, reviewer gate, PR

## Done when

- Batch 1 is published within the 4 MB net budget, byte-identical across two runs.
- El Chocón (`limay-078..094`) and Arroyito (`limay-096..100`) are viewable with slow drift inside the polygon;
  `limay-095` and `limay-101..102` stream along branches and hand off into and out of the reservoirs.
- Sections without a net behave exactly as in F1; `e2e/flow.spec.ts` (`limay-010`) unchanged.
- neuquen-139 meets its F2 criteria, or the remaining shortfall is recorded.
- `npm run check` green; new strings in both locales.

## Owner checks (local)

_Filled in as work packages land._

## Follow-ups

_Filled in as work packages land._
