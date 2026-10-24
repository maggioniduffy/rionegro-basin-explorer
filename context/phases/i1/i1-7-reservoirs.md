<!-- Phase file. Index: [i1-imagery-water.md](../i1-imagery-water.md) · Plan: [PLAN.md](../../PLAN.md) -->

# I1.7 — Whole reservoirs

- [ ] **I1.7 Whole reservoirs (was B1.4)** _(reviewer: data provenance)_. **After I1.T**, so it uses the tuned
      detection; the probe's reservoir-zone panel is used to check El Chocón before the remote rerun. Today the water
      mask is computed on the bounding box of a 1500 m buffer of each section's course (`corridorM`), so El Chocón's
      polygon ends in straight edges in open water (`limay-076..083`), and particles show only at zoom ≥ 12 for one
      section at a time.
  - Pipeline (Python), scope: El Chocón and Arroyito groups only. The index has 58 reservoir sections: Alicurá,
    Piedra del Águila, Pichi Picún Leufú, El Chocón and Arroyito on the Limay, plus `agrio-003` and `varvarco-001`.
    The others reuse the mechanism in later batches.
  - Reservoir **groups** in `flow-water.config.json` `lakes: [{id, hylakId, sections: "limay-076..limay-095"}]`,
    explicit and traceable to HydroLAKES ids. The ids are listed from `lakes.geojson`, and the owner confirms the
    member ranges.
    - A group runs the existing pipeline on a virtual section: the concatenated course of its members, with AOI =
      course buffer ∪ (lake polygon buffered by `lakeMarginM`).
    - One net per group (`lake-<hylakId>.net.json`); members point to it. Resolution stays 10 m unless the grid
      estimate exceeds a memory budget, in which case use `lakes[].resolutionM: 20` (measured first, reported).
    - `FLOWWATER_VERSION` bump.
  - Publish: `flow-net-pub` keeps `driftFrom` (orchestration §8 finding). `nets.json` gains
    `groups: {netId: [sectionIds]}`.
  - App (`lib/flow/data.ts`, network loading, flow view): a member section loads its group net and the camera fits
    the lake; a new display constant sets a lower minimum zoom for reservoir drift (exact value to set in the brief
    after reading the flow layer code); strings in both locales, if the panel changes.
  - Then rerun the groups remotely (`flow-water.yml`) and publish.
  - Acceptance: `npm run check`; one test for the group lookup (a section that maps to its group net, and one that
    doesn't). The report shows the El Chocón polygon IoU against HydroLAKES 981 over the whole lake, and no straight
    AOI edge in open water (QA: the polygon touches the grid border only on land). Owner browser pass.
