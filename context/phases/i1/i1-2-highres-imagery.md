<!-- Phase file. Index: [i1-imagery-water.md](../i1-imagery-water.md) · Plan: [PLAN.md](../../PLAN.md) -->

# I1.2 + I1.4, I1.3 — High-res source, more zoom, alignment check

- [ ] **I1.2 + I1.4 High-res source and more zoom** _(builder; reviewer: license, cost)_. Blocked by I1.1.
  - Add a second raster source (IGN `mosaicos_vuelos` WMTS, `pipeline/SOURCES.md`) that blends in above about
    z13–14, EOX Sentinel-2 below filling its gaps. `nqn` only; `cba` keeps EOX. Map the IGN footprint over the
    basin first (which reaches have tiles). Put its URL and attribution in env vars like `NEXT_PUBLIC_IMAGERY_TILE_URL`. Keep the attribution and
    the snapshot stamp (`lib/map/snapshot.ts`) correct for both sources.
  - Raise `MAP_MAXZOOM` (13) and `FLOW_MAXZOOM` (14.5, `lib/flow/config.ts`) to where the new imagery stays sharp
    (target z16–17 for flow, measured on screen, not guessed); set the raster source's `maxzoom` to the provider's
    real max so MapLibre overzooms rather than requesting tiles that don't exist.
  - HydroRIVERS lines drift off the imagery at close zoom (`lib/map/config.ts`): at high zoom, show only IGN lines
    and channel outlines, or fade the HydroRIVERS lines. Check the mask and the particle trail widths at the new
    zooms.

- [ ] **I1.3 Flow close-up and mask alignment check**: the F1 flow close-up and the mask still line up with the new
      imagery; drop the "soft imagery" note in the flow panel if it no longer applies.
