<!-- Phase file. Index and status: [PLAN.md](../PLAN.md). -->

# Phase R0 — Decisions & inputs ✅

- [x] Option A (one app, region registry), subdomains, `nqn` = the current Río Negro basin, Córdoba = province + the interprovincial basins that reach it, endorheic basins split (one root per sink)
- [x] Domain for subdomains: on Vercel, which kind of domain deferred (owner, 2026-10-10); R1 maps any host to a region through a config table, so the choice needs no code change
- [x] Córdoba scope rule: R2 lists the candidate basins with their areas inside/outside the province, then the owner picks which are whole and which are clipped (e.g. the Salí-Dulce reaches Mar Chiquita from Tucumán)
- [x] Córdoba provincial layers (ArcGIS Experience "Cuencas y Unidades de Gestión"): owner exported ten APRHI layers to `data/raw/`; license read (PIHC terms, IGN-like, usable); published Experience confirmed (2026-10-11). Open: source URL of three layers (possible student copies), see SOURCES.md
- [x] Province boundary: IGN "Provincia" layer in `data/raw/ign/provincia/` (2026-10-12)
- **Done when:** the open items above are decided and recorded in DECISSIONS.md. The ArcGIS item blocks R2's comparison only, not R1.
