<!-- Phase file. Index: [i1-imagery-water.md](../i1-imagery-water.md) · Plan: [PLAN.md](../../PLAN.md) -->

# I1 — Recurring cost flags and owner checks

## Recurring cost flags

- R2: $0 at about 30 MB. The risk is more than 10M Class B reads per month while uncached (until I1.6).
- I1.6: a Route Handler approach adds function invocations and Active CPU per range; to flag once chosen. No custom
  domain (owner, 2026-10-19).
- Actions: $0 while the repo is public. **If it goes private**: 2,000 min/month and 2-CPU runners.
- Imagery provider: must have no tier that bills with traffic (I1.0).

## Owner checks

- Camera hash (I1.P): open `/rionegro/map#14/-39.29/-65.66` → the camera lands there, not on the basin fit;
  `/rionegro/map?r=<river id>#13/-39.0/-68.0` → the river panel opens, the camera stays at the hash, and a later
  search pick fits as usual; `?flow=<section>#15/<lat>/<lon>` → flow opens at the hash; panning updates the hash and
  keeps `?r=`/`?flow=`; without a hash the initial fit is unchanged; `/cordoba/map#12/-31.4/-64.2` works too.
  **Passed (owner, 2026-10-19)** after `ef92883` (MapLibre's `map.remove()` deleted the hash on the dev remount).
  Zoom stays capped at 13 until I1.2. The probe ran from a pasted `--at` (fresh acquisition, 61 s).
- Probe: open `data/work/nqn/flow-water-probe/limay-110/index.html` and check the layers read right.

- Browser: zoom into the Río Negro near Choele Choel and the lower Limay at z15–16 in light and dark. The tiles
  should load without errors and the switch from Sentinel-2 should not be jarring.
