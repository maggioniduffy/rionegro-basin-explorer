<!-- Phase file. Index and status: [PLAN.md](../PLAN.md). -->

# Phase I1 — Sharper imagery, more zoom and particle density (free)

Owner request 2026-10-18. Today the base is EOX Sentinel-2 cloudless 2024 (~10 m, `IMAGERY_MAXZOOM = 15` in
`lib/map/config.ts`; CC BY-NC-SA 4.0). It looks soft at the zoom where braided reaches split into arms
(Río Negro, lower Limay, Neuquén), so the arms are hard to see, and so is the flow close-up (F1).

Goal: sharper imagery (≤ ~1–2 m) at high zoom, at no cost, so the separate river arms can be seen. Keep
Sentinel-2 at low and mid zoom.

## Items

- [ ] I1.0 Candidates and licenses (license-checker): for each candidate, record the resolution over the basin,
      whether it's free with no recurring cost (no tier that bills once traffic grows), whether a key or account is
      needed, whether a public non-commercial site may use it, the required attribution, and whether the browser may
      fetch tiles directly. Candidates to check (none verified yet):
  - Esri World Imagery (the reference app uses it; its terms are listed as unverified in F1 follow-ups).
  - IGN Argentina imagery or orthophoto services (WMS/WMTS), if any cover the basin.
  - Provincial services (Neuquén, Río Negro, Córdoba IDE orthophotos).
  - Mapbox / MapTiler satellite free tiers: they need a token and bill above a quota, so flag the cost risk (Rule 8).
- [ ] I1.1 Owner decision on the provider; record it in DECISSIONS.md and `pipeline/SOURCES.md`.
- [ ] I1.2 Add a second raster source that blends in above about z13–14 (Sentinel-2 below). Make it per region if
      coverage differs. Put its URL and attribution in env vars like `NEXT_PUBLIC_IMAGERY_TILE_URL`. Raise
      `IMAGERY_MAXZOOM` / the map max zoom only where the new source has data. Keep the attribution and the snapshot
      stamp (`lib/map/snapshot.ts`) correct for both sources.
- [ ] I1.3 Check that the F1 flow close-up and the mask still line up with the new imagery; drop the
      "soft imagery" note in the flow panel if it no longer applies.
- [ ] I1.4 More zoom (owner 2026-10-18), together with I1.2: today the map max zoom is 13, and 14.5 in flow mode
      (`FLOW_MAXZOOM` in `lib/flow/config.ts`). Raise both to where the new imagery stays sharp (target z16–17
      for flow, measured on screen, not guessed) and set the raster source's `maxzoom` to the provider's real max
      so MapLibre overzooms rather than requesting tiles that don't exist. HydroRIVERS lines drift off the imagery at
      close zoom (`lib/map/config.ts`): at high zoom, show only IGN lines and channel outlines, or fade the
      HydroRIVERS lines. Check the mask and the particle trail widths at the new zooms.
- [ ] I1.5 Particle density option (owner 2026-10-18). This item doesn't depend on the imagery and can be done
      first. Add a control in the flow bar (`components/flow/FlowControls.tsx`) to raise the particle count,
      e.g. 1× / 2× / 4× of `FLOW_PARTICLES` (3000 per section today). It goes in the store with the playback
      speed, optionally as a URL param like `fs`, with labels in EN and ES. Resizing must reallocate the
      `ParticleState` buffers in `lib/flow/particles.ts` without restarting the section. Measure fps at 4× on a
      mid laptop before choosing the top option, and drop it if it goes below ~50 fps. With reduced motion,
      keep the default.
- **Done when:** in both regions, the arms of a braided reach (e.g. the Río Negro near Choele Choel) are visible
  at z15–16; flow mode zooms past z14.5 with imagery that stays sharp; the particle density control works in EN and ES
  and holds ~60 fps at the default; the provider's license is verified and recorded in SOURCES.md; there is no recurring
  cost; attribution shows on the map and in snapshots; `npm run check` is green.

## Owner checks

- Browser: zoom into the Río Negro near Choele Choel and the lower Limay at z15–16 in light and dark. The tiles
  should load without errors and the switch from Sentinel-2 should not be jarring.
