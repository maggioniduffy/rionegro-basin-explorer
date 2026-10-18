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
  `Líneas_de_ribera.CAUDAL_DE_` is a design flood, `cba` only. SNIH/BDHI is a follow-up (below).
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
- [x] F1.6 Gate: `e2e/flow.spec.ts` screenshot, SOURCES.md, DECISSIONS.md, reviewer gate (one block, fixed), PR

## Done when

- Selecting a section flies to a close-up where particles fill the channel and animate.
- Selecting another section replaces it.
- Zooming out hides the particles.
- The controls and the URL state work.
- The legend and the caveats appear in EN and ES.
- `npm run check` passes, and `e2e/flow.spec.ts` is green.
- `flow-sections` reports are ok, two runs are identical, and `nqn` `data/out` is unchanged.

## Owner checks (browser, local)

- [x] `npm run pipeline:flow-sections -- --region nqn` twice: report ok, outputs identical, `nqn` `data/out` unchanged; `npm run check`; `e2e/flow.spec.ts` green.
- [ ] `/rionegro/map`: select the Limay, press "View flow": the camera fits the section at about z14 and particles move inside the channel. Click the Neuquén while paused: the section switches without zooming out and stays paused. Pan past a section's end: the next one loads without a camera jump; "Upstream"/"Downstream" do the same.
- [ ] Zoom out below z12: particles fade, "Zoom back in" re-fits. Play/pause, 0.5×–4×, Escape and "Exit flow view" work; the map returns to max z13.
- [ ] A copied `?flow=…&fs=2` URL opens the same close-up at 2×. With reduced motion on, flow starts paused. Switching tabs and back causes no jump.
- [ ] Cross-region: from `/rionegro/map?flow=limay-010` go to Attributions, then the Córdoba map via the footer: no flow panel, controls or dimmed rivers, no `flow=` in the URL.
- [ ] EN/ES, light/dark, 1440 px and 390 px (controls at the top on phones; panel in the sheet). Known: the fit leaves no room for the control bar, so the downstream end can sit under it.
- [ ] Río Negro on the EOX imagery: particles stay in the main channel (`span.maxSpanM` = 800 is provisional).
- [ ] 60 fps on a mid laptop with particles on screen. Clicking empty map exits flow: confirm that's wanted.
- [ ] Full `npm run test:e2e` once: the e2e build now sets `NEXT_PUBLIC_E2E=1` (test hooks only).
- [ ] Restart `npm run dev` after switching to this branch (`NEXT_PUBLIC_FLOW_VERSIONS` is computed at startup; without it no flow button shows).
- [ ] Hub `/` then the Río Negro map via the link: the legend shows real text (no `legend.*` keys) in ES and EN; going on to Córdoba via the footer leaves no Río Negro strings.
- [ ] Select the Limay (and a Limay reach): the filled "Ver flujo" button sits under the name, readable in light and dark, and enters flow.

## Follow-ups

- **Measured discharge.** None in the repo. Candidate: SNIH/BDHI station means. Check the license, then the owner downloads the series; a step would snap stations to sections with `kind: "measured"`, which wins. APRHI `CAUDAL_DE_` is a design flood; not used.
- **Flow mode for `cba`.** R5 courses exist, but there are few channel polygons, so most sections would use the estimated band.
- **Sharper imagery.** Sentinel-2 is 10 m. Esri World Imagery's terms are unverified; check before considering it.
