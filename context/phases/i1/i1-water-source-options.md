<!-- Reference note for I1.T and I1.7. Index: [i1-imagery-water.md](../i1-imagery-water.md). -->

# Water source options (2026-10-28)

Options looked at to refine or check the water detection (`pipeline/py/flowwater/`, Sentinel-2 MNDWI frequency)
instead of, or alongside, tuning or training our own detector. Nothing here is adopted yet. Every source still needs
`license-checker` and a `pipeline/SOURCES.md` entry before use.

## Rejected

- **MODIS/Terra and MODIS/Aqua L0 PDS 5-min swath (NRT)** (`MOD00F`, `MYD00F`). Raw instrument packets: not
  calibrated, not georeferenced, no reflectance. Using them needs SeaDAS/IMAPP processing to L1B/L2. 250 m at best,
  so the braided channels (tens of metres wide) are sub-pixel. About 8,000 swaths for our polygon, almost all of
  each outside it. Worse than the 10 m Sentinel-2 we already use.

## Candidates

| Product                     | Resolution | Where                          | What it gives                                                               |
| --------------------------- | ---------- | ------------------------------ | --------------------------------------------------------------------------- |
| OPERA DSWx-HLS v1           | 30 m       | Earthdata (PO.DAAC)            | Per-scene water classes (`B01_WTR`: open, partial, not water, cloud, no data) |
| JRC Global Surface Water    | 30 m       | JRC / Google Earth Engine      | Water occurrence 1984–2021 per pixel (long-term prior)                      |
| Dynamic World               | 10 m       | Google Earth Engine            | Per-scene water class at Sentinel-2 resolution                              |
| HLS (`HLSS30`, `HLSL30`) v2 | 30 m       | Earthdata (LP DAAC)            | Surface reflectance only (no water class); more dates under clouds          |

Notes:

- **DSWx-HLS covers `nqn`**: Earthdata Search returned 2,916 granules for the Limay polygon (MGRS tiles T19GDR,
  T19HDS), October 2026 included. Collection short name believed to be `OPERA_L3_DSWX-HLS_V1`; confirm on its info
  page.
- **HLS** is the input DSWx is built from. Use it only if we want our own MNDWI on more dates; at 30 m it is coarser
  than the Sentinel-2 L2A we read now.
- **Search in Earthdata Search**: type the short name (`HLSS30`, `HLSL30`, `OPERA DSWx-HLS`), keep the polygon, set
  Temporal and Cloud Cover, add to the project. Do not use "Download All". For the pipeline use `earthaccess` or
  CMR-STAC.
- Licenses to verify: NASA open data (OPERA, HLS), CC BY 4.0 (JRC, Dynamic World), as far as known.

## Fit for I1

- **Braided reaches (I1.T)**: 30 m sources should lose arms narrower than about 2 pixels (~60 m). But the owner's
  look at one DSWx scene at the Limay–Neuquén confluence (2026-10-28, Earthdata Search, ~1 km scale) shows the main
  channel solid and most side arms continuous, helped by the "partial water" class. Noise seen: scattered partial
  water over the city and fields, and cyan specks (probably the snow/ice class). Next step: compare DSWx with our
  mask on the hard captures (the failed owner-check sections) before choosing it as detector or as reference.
- **Reservoirs (I1.7)**: reservoirs are hundreds of metres to kilometres wide, so DSWx (or a DSWx frequency over
  several dates) is enough to outline them.
