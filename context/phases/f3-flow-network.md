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

- **No full run.** The step runs in resumable batches. Batch 1 was planned as El Chocón and Arroyito
  (`limay-076..limay-102`, 27 sections); the owner stopped it at 9 of them (`limay-076..083`, `limay-096`) to
  test and move on (2026-10-18). The other 18 (`limay-084..095`, `limay-097..102`) run after phase B1.
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
- [x] F3.1 flow-water: batches and resume, connectors before dead-end pruning, reservoir hub in/out, drift
      convergence, SCL class 2 measurement; pytest: 3 cases
- [x] F3.2 `pipeline:flow-net-publish` (QA gate, `flow-net-pub/1`, `nets.json`, 4 MB budget, report); vitest:
      round trip
- [x] F3.3 `lib/flow/network.ts`, net particles (hand-off, reservoir drift), branch speed; tests: shares, bounds
- [x] F3.4 Loading (`nets.json`, nets), FlowController and layer (shared origin, cached uniforms), flowability of
      reservoir sections
- [x] F3.5 FlowPanel / legend copy (network vs single track, reservoir drift, illustrative shares), attribution;
      EN/ES
- [ ] F3.6 Batch 1 run and publish, reviewer gate, PR

## Done when

- The 11 finished nets are published within the 4 MB net budget, byte-identical across two runs. **Met**
  (11/11 pass the gate, 48 KB).
- The upper El Chocón sections (`limay-078..083`) and Arroyito (`limay-096`) are viewable, with slow drift inside
  the polygon; `limay-076..077` (reservoir tail), `limay-110` and `neuquen-139` stream along branches and hand off
  into reservoirs where they have one.
- Sections without a net behave exactly as in F1; `e2e/flow.spec.ts` (`limay-010`) unchanged.
- neuquen-139 meets its F2 criteria, or the remaining shortfall is recorded.
- `npm run check` green; new strings in both locales.

## Owner checks (local)

- [ ] After batch 1, open every `kind == "connector"` branch of `data/work/nqn/flow-water/out/*.qa.geojson` in
      QGIS over imagery: each bridges a real dry gap (dam, weir, bar) along the course, not a tributary or canal.

- [ ] `npm run dev` (restart: the flow version hash is computed at startup), then on `/rionegro/map` in EN and ES:
  - `?flow=limay-080`: slow drift inside El Chocón; panel says "Reservoir outline from Sentinel-2 imagery" and
    shows the drift note.
  - `?flow=limay-076`: dense network into the reservoir tail. Does it read as the real delta or as noise
    (owner kept it published, 2026-10-19)?
  - `?flow=limay-096`: two branches hand off into Arroyito; `?flow=limay-110`: braided arms and the shares note;
    `?flow=neuquen-139`: branches into its reservoir, the 390 m connector.
  - `?flow=limay-010`: unchanged F1 look, "Single track along the IGN course".
  - Reservoir sections (`limay-078..083`) are offered by "View flow", Upstream/Downstream and a click.
  - 60 fps with particles on screen, also inside a reservoir.
- [ ] `/rionegro/attributions` shows the Sentinel-2 and Copernicus DEM cards; `/cordoba/attributions` does not.
- [ ] `npx playwright test e2e/flow.spec.ts`: the `limay-010` baseline is unchanged (no net there).

## Follow-ups

- **neuquen-139 wet-course coverage 0.93** (target 0.95): the course is uncovered at chainage 1280–1440,
  2700–3060 (inside the reservoir's course extent, outside its polygon) and 3660–4000 (dry in the mask past the
  reservoir). Not tuned further; the publish gate takes ≥ 0.9.
- **SCL class 2 in the Andes:** it adds at most 0.008 km² on the four F2 sections, none of them in shadow; measure
  again when an Andean batch (Aluminé, upper Neuquén) runs (`water.sclClass2` in each section report).
- **Skip hash and code:** code changes are covered only by bumping `FLOWWATER_VERSION` (`cli.py`).
