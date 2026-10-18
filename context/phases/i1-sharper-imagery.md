<!-- Phase file. Index and status: [PLAN.md](../PLAN.md). -->

# Phase I1 — Sharper imagery at high zoom (free)

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
- **Done when:** in both regions, the arms of a braided reach (e.g. the Río Negro near Choele Choel) are visible
  at z15–16; the provider's license is verified and recorded in SOURCES.md; there is no recurring cost; attribution
  shows on the map and in snapshots; `npm run check` is green.

## Owner checks

- Browser: zoom into the Río Negro near Choele Choel and the lower Limay at z15–16 in light and dark. The tiles
  should load without errors and the switch from Sentinel-2 should not be jarring.
