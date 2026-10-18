<!-- Phase file. Index and status: [PLAN.md](../PLAN.md). -->

# Phase F1 — Flow close-up (`nqn`)

Plan approved 2026-10-18 ([DECISSIONS.md](../DECISSIONS.md#phase-f1-flow-close-up-2026-10-18)). Branch `phase-f1-flow-closeup`.

A close-up "flow" view of one river section. The camera fits a 3–5 km section at about z14 over the satellite base,
and about 3,000 particles stream along the real channel with fading trails. They are coloured by **relative**
speed (blue → cyan → green → yellow → magenta), and a panel, controls and a legend sit alongside. State lives in
the store and the URL (`?flow=<sectionId>&fs=<mult>`).

## Owner decisions (2026-10-18)

- **Speed is relative and illustrative**, never m/s. No source has velocity.
  - v(s, u) = (1 − |u|⁴) × W̄ / W(s), normalised to a section maximum of 1.
  - The 1 − |u|⁴ term is the lateral profile.
  - The W̄ / W(s) term is continuity at constant depth.
- **Discharge is modeled only for now** (HydroRIVERS `DIS_AV_CMS`, 1971–2000 natural mean). The schema has a
  `kind: "measured"` slot, so measured values can win later. No measured source exists in the repo: APRHI
  `Líneas_de_ribera.CAUDAL_DE_` is a design flood, `cba` only. SNIH/BDHI is a follow-up (PENDING.md).
- **Imagery stays EOxCloudless**. The max zoom is 14.5 in flow mode only (13 otherwise). Channels under 30 m are
  not offered (`narrow`).
- **`nqn` named rivers first**; `cba` in a later phase.

## Design summary

- **Sections.** Fixed windows along each named river's IGN course: n = round(L / 4 km).
  - id `<riverSlug>-<nnn>`, counted from the source.
  - The course comes from `buildCourse` (`pipeline/lib/river-course.ts`) over the `nqn` IGN lines, with its own
    `regions/nqn/flow.config.json`, so `nqn` `data/out` stays byte-identical.
  - Gaps fall back to the HydroRIVERS path, flagged.
- **Discharge.** Taken from the river's reach nearest the window midpoint, with the reach's DOR. Not flowable when:
  - `noDischarge`: Q is null or 0
  - `reservoir`: the midpoint is in a lake polygon
  - `narrow`: the channel is under 30 m wide
- **Channel.**
  - IGN BH140 "Corriente de agua" polygons. A station every 20 m stores the wet span `[nLeft, nRight]` across the
    normal.
  - Fallback: a band from RiverATLAS `ria_ha_csu` / reach length, labelled "estimated width".
  - Spans over `maxSpanM` fall back to the band (BH140 Río Negro may include floodplain).
- **Data.** Static: the step writes `public/flow/nqn/<sectionId>.json` and one `index.json` for the region; the URL is versioned by a build-time content hash (`/flow/<region>/<hash>/…`, rewritten like the tiles, F1.4).
  Budget ≤ 8 MB, no route handler, no Mongo.
- **Rendering.** One MapLibre `CustomLayerInterface`.
  - Particles live in (s, u) section coordinates and are stepped on the CPU with a seeded PRNG.
  - Trails are an 8-position ring buffer in Mercator, relative to the section origin.
  - Repaint only while playing, the tab is visible and zoom ≥ `FLOW_MIN_ZOOM` (12).
  - `prefers-reduced-motion` starts paused.
- **Interaction.**
  - Enter with "View flow" in the river or reach panel: the section nearest the last click, else the most
    downstream flowable one.
  - In flow mode, a click on another river replaces the section.
  - Panning nearer an adjacent section switches to it; upstream and downstream buttons do the same.
  - Zooming out fades the particles and shows a "zoom back in" hint.
  - Reach lines dim to 0.2 in flow mode.

## Work packages

- [x] F1.0 Split PLAN.md into one file per phase (owner, 2026-10-18)
- [x] F1.1 `pipeline:flow-sections --region nqn` (IGN course, windows, BH140 spans, band fallback, discharge and
      reason, `report.json`, `public/flow/nqn/`); tests: window cut, station span
- [x] F1.2 `lib/flow/` pure lib (schema, parametrisation, `inChannel`, speed field, colour scale, particle step);
      tests: 1–2 cases each
- [x] F1.3 WebGL custom layer and loop (visibility, reduced motion, zoom fade, E2E step hook)
- [x] F1.4 Store, URL (`flow`, `fs`), UrlSync, MapView (max zoom, fit, dim, click to switch, pan to adjacent),
      "View flow" buttons; test: url-state round trip
- [x] F1.5 FlowPanel, FlowControls, FlowLegend, zoom-out hint, EN/ES strings
- [ ] F1.6 Gate: `e2e/flow.spec.ts` screenshot, SOURCES.md, DECISSIONS.md, RUN_LOCAL.md, PENDING.md, reviewer, PR

## Done when

- Selecting a section flies to a close-up where particles fill the channel and animate.
- Selecting another section replaces it.
- Zooming out hides the particles.
- The controls and the URL state work.
- The legend and the caveats appear in EN and ES.
- `npm run check` passes, and `e2e/flow.spec.ts` is green.
- `flow-sections` reports are ok, two runs are identical, and `nqn` `data/out` is unchanged.
