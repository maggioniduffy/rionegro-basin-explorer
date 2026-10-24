<!-- Phase file. Index: [i1-imagery-water.md](../i1-imagery-water.md) · Plan: [PLAN.md](../../PLAN.md) -->

# I1.0–I1.1 — Imagery candidates, licenses and provider decision (done)

- [x] **I1.0 Imagery candidates and licenses** (license-checker, read-only). Runs in parallel with I1.6. For each
      candidate, record the resolution over the basin, whether it's free with no recurring cost (no tier that bills
      once traffic grows), whether a key or account is needed, whether a public non-commercial site may use it, the
      required attribution, whether the browser may fetch tiles directly, and **whether data may be derived from it**
      (owner-drawn truth polygons traced on it). Candidates (none verified yet):
  - Esri World Imagery (the reference app uses it; its terms are listed as unverified in F1 follow-ups).
  - IGN Argentina imagery or orthophoto services (WMS/WMTS), if any cover the basin.
  - Provincial services (Neuquén, Río Negro, Córdoba IDE orthophotos).
  - Mapbox / MapTiler satellite free tiers: they need a token and bill above a quota, so flag the cost risk (Rule 8).
  - Any other free ≤2 m source the checker finds.

  Output: a table for SOURCES.md and a recommendation. **Done 2026-10-19**: Esri and Mapbox bill with traffic;
  MapTiler Free is hard-capped but forbids server caching (plan B); IGN `mosaicos_vuelos` is free, keyless,
  CORS-enabled and allows tracing, but its coverage is patchy (none at El Chocón). Table in `pipeline/SOURCES.md`.

- [x] **I1.1 Owner decision on the provider**; record it in DECISSIONS.md and `pipeline/SOURCES.md`. Owner,
      2026-10-19: IGN `mosaicos_vuelos` above EOX, **`nqn` only** (`cba` keeps EOX; no Córdoba imagery pursued).
