<!-- Phase file. Index and status: [PLAN.md](../PLAN.md). -->

# Phase E1 — Effluent impact explorer (`cba`)

Plan approved 2026-10-29 ([DECISSIONS.md](../DECISSIONS.md#phase-e1-effluent-impact-2026-10-29)). Branch
`phase-e1-effluents`. Built for the Hack to the Future hackathon (Córdoba Cluster, 12–13 Nov 2026, in person;
prior work allowed; registered teams get instructions on 2 Nov).

**Question it answers (user = the regulator, APRHI or a municipality):** for a discharge point and the river flow
now or in the coming days, how far downstream does the river exceed a threshold, what load is admissible at that
flow, and what removal is needed? Córdoba's permits are concentration-only (Decreto 847/16 bans dilution and sets no
load or receiving-water criterion); what a river can take depends on its flow.

It is a **screening model**, not a calibrated water-quality model, and the UI says so. Every coefficient is a
literature range with its citation; every assumption is listed in the panel.

## Demo reaches (owner, 2026-10-29)

- **Suquía (river `primero`), Centro Cívico → Bajo Grande → downstream:** BOD + dissolved oxygen (Streeter‑Phelps)
  and fecal coliforms. Bajo Grande is probably on reach 61477479 (to confirm, owner check).
- **Cosquín / San Antonio → Embalse San Roque (`aprhi-emb-4`):** total phosphorus + OECD/Vollenweider (stretch).
  In-lake reaches 61476495 and 61476899 feed 61476496 (Primero source).

## Design

- **Flow at a reach and date** (gauges `san-roque-inflow` above the dam, `centro-civico` below): Q_reach(t) = `dischargeM3s` (HydroRIVERS, 1971–2000 natural mean) ×
  Q_glofas(t) / Q_glofas_clim. GloFAS v4 via the Open‑Meteo Flood API, at hand-checked cells; the climatology is
  GloFAS's own reanalysis mean at the same cell (non-null from 1997-01-01 to 2022-07-31). Scenarios: long-term mean, today, forecast day N
  (p25/median/p75).
- **River model** (`lib/effluent/`, pure TS, client-side): downstream walk on `nextDown` (edited links applied);
  complete mixing at the outfall; travel time L/v with v = a·Q^m; first-order decay (BOD, coliforms); Streeter‑Phelps
  DO deficit with ka by the Covar rule (O'Connor‑Dobbins / Churchill / Owens‑Gibbs); dilution at confluences.
  Outputs: concentration and exceedance per reach, plume length, minimum DO and where, admissible load (the response
  is linear in load), required removal %, low/central/high band.
- **Reservoir model** (stretch): San Roque as one completely mixed node, OECD P_lake = 1.55·[P_in/(1+√τ)]^0.82,
  OECD trophic classes; annual steady state, so annual-flow scenarios only.
- **Map:** overlay layer on the existing `rivers`/`reaches` tiles, colour by `match ["id"]` built at runtime
  (the `FlowController` pattern). No tile rebuild.
- **Data:** `pipeline:effluent-net` writes `regions/cba/effluent-net.json` (Suquía basin subgraph, gauge cells and
  their GloFAS climatology, lake node) from `regions/cba/effluent.config.json`.
- **Out of scope:** live gauge levels (Omixom has no public API; APRHI publishes station metadata only).

## Checklist

- [x] E1.0 Phase file, PLAN.md row, DECISSIONS.md entry, `pipeline/SOURCES.md` (Open‑Meteo/GloFAS; parameter references)
- [x] E1.1 `regions/cba/effluent.config.json` + `pipeline:effluent-net` → `regions/cba/effluent-net.json` + report.json
- [ ] E1.2 `lib/effluent/` pure model + `tests/effluent-model.test.ts`
- [ ] E1.3 `app/[region]/api/discharge/route.ts` (Open‑Meteo, validated, timeout, cached, 404 without config)
- [ ] E1.4 Effluent mode: store slice, `?ef=` URL param, overlay controller, legend, "Simulate a discharge here" in `ReachPanel`
- [ ] E1.5 `EffluentPanel`: inputs, outputs, caveats with periods, assumptions, attribution (`lib/attributions.ts`), EN + ES
- [ ] E1.6 _(stretch)_ San Roque panel: TP inflow, predicted TP range, trophic class
- [ ] E1.H _(stretch)_ Historical runs over the GloFAS reanalysis: per month, % of days below the DO threshold and admissible-load percentiles
- [ ] E1.R _(optional)_ Gauge level → flow through the colleague's H‑Q curves (needs their parameters and permission)
- [ ] E1.F _(final, spike first)_ Flow particles coloured by concentration, on a net derived from reach centrelines
- [ ] Gate (orchestration.md §6) and PR

Order: E1.0 → E1.5 is the MVP (target 8 Nov), then E1.6 / E1.R / E1.H, gate by 11 Nov. E1.F only if time is left.

**Done when:** on `/cordoba`, clicking a reach on the Suquía and simulating a discharge colours the reaches
downstream; switching mean / today / forecast changes the plume length and admissible load; the panel shows
assumptions, periods and attribution in EN and ES; `?ef=` survives a reload; `/rionegro` is unchanged;
`pipeline:effluent-net` report ok; `npm run check` green.

## Roadmap after the hackathon (E2, not scheduled)

ML in the order it adds value: (1) GloFAS bias correction to local flow with the colleague's H‑Q curves and
APRHI/INA gaugings; (2) calibrate kd/ka/decay once water-quality monitoring data exist (INA‑CIRSA, CEQUIMAP);
(3) a discharge-scheduling policy (storage and release timing) optimised over historical and forecast runs. With a
screening model and no monitoring data, ML would only learn the model back.

## Owner checks

- [ ] Register for the hackathon by 31 Oct (https://forms.gle/JPukJPq7qyHWxhDs8); read the 2 Nov instructions.
- [ ] In a browser: the coliform limit in Decreto 847/16 Annex I and the Res. APRHI 3/2025 P/NH₃ values (scripted fetches get 403).
- [ ] Locate the Bajo Grande outfall on imagery; confirm reach 61477479.
- [ ] Ask the colleague for permission and their posterior H‑Q curve parameters (unlocks E1.R).
- [ ] Browser check `/cordoba` on the phase preview; decide whether to ship to production before the event.

## Follow-ups

- Effluent BOD/coliform values for Bajo Grande are not public: the panel defaults to the permit limit
  ("compliance scenario") and leaves them editable.
- No dissolved-oxygen objective in Córdoba's rules: 5 mg/L is an explicit, editable assumption.
