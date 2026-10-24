<!-- Phase file. Index: [i1-imagery-water.md](../i1-imagery-water.md) · Plan: [PLAN.md](../../PLAN.md) -->

# I1.6 — Vercel CDN cache for tiles and flow

- [ ] **I1.6 Vercel CDN cache for tiles and flow (was B1.5)** _(reviewer: cost)_. Owner, 2026-10-19: use Vercel's
      cache, no custom domain. Since #13 nothing is cached: every PMTiles range goes through Vercel to r2.dev, which
      is rate-limited and "non-production". Scout Vercel's docs before building; approaches to verify, cheapest
      first:
  - The CDN caches the **whole object** and serves ranges from it: the rewrite (or a Route Handler) asks R2 without
    `Range` and returns a 200 with `s-maxage`/`Vercel-CDN-Cache-Control`. Works only if Vercel's CDN answers a
    `Range` request from a cached 200; that is the first thing to check.
  - Cache each range separately: a 206 keyed by URL + `Range` (`Vary: Range`, or the range moved into the URL by the
    client's PMTiles source). Only if Vercel honours that key; the cached rewrite in #12 did not.
  - A Route Handler slices ranges from a whole object held in Vercel's Runtime Cache or the `fetch` cache. Check item
    size limits against the largest file (cba `mask.pmtiles`, 8.5 MB) and the cost of a function invocation and
    Active CPU per range.

  Out: a custom domain (owner). Gate: on a Preview, at least three distinct ranges of one `.pmtiles` each return
  their own `content-range`, twice, and the second pass shows `x-vercel-cache: HIT`; the map and flow load with no
  console errors; cost flags updated.
