# Data sources, licenses and attribution

Keep this file current (CLAUDE.md rule 9). The public credits page (`/attributions`, data in
`lib/attributions.ts`) mirrors it: change both together. A license counts as **verified** only when
someone has read the provider's own license text; the date says when. "Downloaded" is
taken from `pipeline/checksums.json` (UTC date), written by `pipeline:download`.

## Summary

| Source                                 | Used for                                                                      | License                                                                | Commercial use                                     | Verified                                    | Downloaded                        |
| -------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------- | --------------------------------- |
| HydroRIVERS v1.0                       | River network geometry, topology                                              | HydroSHEDS v1 License Agreement (WWF), incl. Exhibit B attribution     | Yes                                                | 2026-09-29                                  | 2026-09-30                        |
| HydroBASINS v1c                        | Basin delineation, sub-basins                                                 | HydroSHEDS v1 License Agreement (WWF), incl. Exhibit B attribution     | Yes                                                | 2026-09-29                                  | 2026-09-30                        |
| HydroATLAS v1 (RiverATLAS, BasinATLAS) | River/basin attributes (discharge, pop, etc.)                                 | CC BY 4.0                                                              | Yes                                                | 2026-09-29                                  | 2026-09-30 (RiverATLAS only)      |
| GIRES v1.0 (non-perennial rivers)      | Flow-intermittence class per reach                                            | CC BY 4.0 per figshare metadata (README wording ambiguous, see below)  | Yes, if CC BY                                      | 2026-09-30                                  | 2026-09-30                        |
| HydroLAKES v1.0                        | Lake and reservoir polygons (line clipping, mask, outlines)                   | CC BY 4.0                                                              | Yes                                                | 2026-09-30                                  | 2026-09-30                        |
| IGN Argentina — SIG layers             | Watercourse names, detail lines, lake names and extra lakes, dams (Phase 5)   | IGN "Términos y Condiciones" (custom, no named license; **not** CC BY) | Only for derived works; non-commercial use is fine | 2026-10-01 (terms read; layer metadata not) | — (local copy origin unknown)     |
| OpenStreetMap                          | River name evidence (Phase 1); localities (Phase 7); reservoirs, dams (later) | ODbL 1.0                                                               | Yes (share-alike on the database)                  | 2026-09-30                                  | 2026-09-30 (Overpass, basin bbox) |
| Imagery: EOX Sentinel-2 Cloudless      | Satellite basemap (chosen)                                                    | CC BY-NC-SA 4.0 (non-commercial); commercial needs an EOX license      | Only with an EOX commercial license                | 2026-09-29                                  | n/a (tiles)                       |
| Imagery: Esri World Imagery            | Candidate satellite basemap                                                   | **Not verified** (Esri terms of use)                                   | Unknown                                            | —                                           | n/a (tiles)                       |

## HydroSHEDS core: HydroRIVERS, HydroBASINS

- URLs:
  - https://www.hydrosheds.org/products/hydrorivers
  - https://www.hydrosheds.org/products/hydrobasins
- Downloads (South America):
  - HydroRIVERS: https://data.hydrosheds.org/file/HydroRIVERS/HydroRIVERS_v10_sa_shp.zip
  - HydroBASINS: https://data.hydrosheds.org/file/hydrobasins/standard/hybas_sa_lev01-12_v1c.zip
- License: the HydroSHEDS v1 License Agreement, Appendix A of the
  [Technical Documentation v1.4](https://data.hydrosheds.org/file/technical-documentation/HydroSHEDS_TechDoc_v1_4.pdf).
  The document states that the core data "are free for non-commercial and commercial use".
  Section 2.2 requires the Exhibit B attribution in the documentation or metadata of any derived product.
- **Required attribution** (Exhibit B, verbatim; the product name is filled in):

  > This product Río Negro Basin Explorer incorporates data from the HydroSHEDS version 1
  > database which is © World Wildlife Fund, Inc. (2006-2022) and has been used herein under
  > license. WWF has not evaluated the data as altered and incorporated within Río Negro Basin
  > Explorer, and therefore gives no warranty regarding its accuracy, completeness, currency or
  > suitability for any particular purpose. Portions of the HydroSHEDS v1 database incorporate
  > data which are the intellectual property rights of © USGS (2006-2008), NASA (2000-2005),
  > ESRI (1992-1998), CIAT (2004-2006), UNEP-WCMC (1993), WWF (2004), Commonwealth of Australia
  > (2007), and Her Royal Majesty and the British Crown and are used under license. The
  > HydroSHEDS v1 database and more information are available at https://www.hydrosheds.org.

- Citations:
  - HydroSHEDS: Lehner, B., Verdin, K., Jarvis, A. (2008): New global hydrography derived from
    spaceborne elevation data. Eos, Transactions, AGU, 89(10): 93-94.
  - HydroRIVERS / HydroBASINS: Lehner, B., Grill, G. (2013): Global river hydrography and network
    routing: baseline data and new approaches to study the world's large river systems.
    Hydrological Processes, 27(15): 2171–2186.

## HydroATLAS (RiverATLAS, BasinATLAS)

- URL: https://www.hydrosheds.org/products/hydroatlas
- Downloads: global only, 1.4 to 4 GB depending on dataset and format. No South America extract is published.
  - RiverATLAS (FileGDB, 2.33 GB as listed; 2,506,480,742 bytes served), linked from the product page as
    `https://figshare.com/ndownloader/files/20087321`. That host blocks non-browser clients, so the pipeline
    uses `https://ndownloader.figshare.com/files/20087321`, which serves the same file
    (`RiverATLAS_Data_v10.gdb.zip`) via a redirect to S3.
- License: CC BY 4.0.
- Citation: Linke, S., Lehner, B., Ouellet Dallaire, C., Ariwi, J., Grill, G., Anand, M.,
  Beames, P., Burchard-Levine, V., Maxwell, S., Moidu, H., Tan, F., Thieme, M. (2019): Global
  hydro-environmental sub-basin and river reach characteristics at high spatial resolution.
  Scientific Data 6: 283. https://doi.org/10.1038/s41597-019-0300-6
  (Authors, title, journal and DOI verified against the DOI's citation metadata on 2026-10-03.)
- Attributes used (Phase 3; units and sources from `RiverATLAS_Catalog_v10.pdf`, all listed there
  as CC BY 4.0). Each is shown with its own period in the app:
  - `ele_mt_cmn`, `sgr_dk_rav`: EarthEnv-DEM90 elevation and reach gradient.
  - `inu_pc_umn`, `inu_pc_umx` (sheet H03, percent): GIEMS-D15 inundation extent, satellite data
    1993–2004. Fluet-Chouinard, E., Lehner, B., Rebelo, L. M., Papa, F., & Hamilton, S. K. (2015).
    Remote Sensing of Environment, 158, 348–361.
  - `lka_pc_use` (sheet H04, percent × 10): limnicity from HydroLAKES (Messager et al., 2016).
  - `dor_pc_pva` (sheet H07, percent × 10, capped at 1000 %): degree of regulation from GRanD v1.1
    dams (Lehner et al., 2011, Frontiers in Ecology and the Environment 9(9), 494–502). This is
    GRanD as delivered inside RiverATLAS; GRanD itself is still not downloaded (see HydroLAKES).
  - `pop_ct_usu` (sheet A01, thousands): GPWv4 population count for 2010 (CIESIN, 2016,
    https://doi.org/10.7927/H4X63JVC).
- Caveat (CLAUDE.md rule 4): discharge is a modeled natural average for 1971–2000 that does not
  reflect current dam regulation; population is a 2010 estimate; inundation is 1993–2004
  satellite data; regulation is based on GRanD v1.1 dams.

## GIRES v1.0: global prevalence of non-perennial rivers and streams

- URL: https://doi.org/10.6084/m9.figshare.14633022 (figshare article 14633022)
- Download: `GIRES_v10_gdb.zip` (1,699,860,028 bytes, figshare MD5 `75d41f596ee84cb7b78ed55b5b85e878`,
  verified by `pipeline:download`), via `https://ndownloader.figshare.com/files/28280484`.
- Content: HydroRIVERS/RiverATLAS reaches with modeled mean annual flow > 0, joined by `HYRIV_ID`.
  We use `predprob1`/`predcat1` (probability/class that a reach stops flowing ≥ 1 day a year) and
  `predprob30`/`predcat30` (≥ 30 days). Class 1 = non-perennial (probability ≥ 50%).
- License: figshare metadata says **CC BY 4.0**, and the README links the CC BY 4.0 legal code, but
  its sentence reads "Creative Commons Attribution-ShareAlike 4.0 International License (CC-BY-4.0
  License)". We treat it as CC BY 4.0. If ShareAlike were intended, derived data that includes these
  fields would need to be CC BY-SA. To resolve it, ask the authors (contacts in the README).
- Citation (as requested in the README): Messager, M. L., Lehner, B., Cockburn, C., Lamouroux, N.,
  Pella, H., Snelder, T., Tockner, K., Trautmann, T., Watt, C. & Datry, T. (2021). Global prevalence
  of non-perennial rivers and streams. Nature. https://doi.org/10.1038/s41586-021-03565-5.
  Also link the repository DOI above.
- Caveat: these are random-forest **model predictions**, not observations. The UI must say so, like
  the HydroATLAS caveat (CLAUDE.md rule 4).

## HydroLAKES v1.0

- URL: https://www.hydrosheds.org/products/hydrolakes
- Download: global only, with no regional extract.
  - Polygons: https://data.hydrosheds.org/file/hydrolakes/HydroLAKES_polys_v10_shp.zip (820,295,132 bytes by
    HEAD, 2026-09-30).
  - The pipeline clips the polygons to the basin.
- License: CC BY 4.0. [Technical Documentation v1.0](https://data.hydrosheds.org/file/technical-documentation/HydroLAKES_TechDoc_v10.pdf),
  s4.1 (read 2026-09-30), says: "The HydroLAKES database (version 1.a) is licensed under a Creative Commons
  Attribution 4.0 International License."
- The authors also make a request, which is not a license term: "we ask users to refrain from redistributing
  the data in whole in its original format on other websites without the explicit written permission from
  the authors". We only publish derived, clipped tiles.
- Citation (s4.4, verbatim): Messager, M.L., Lehner, B., Grill, G., Nedeva, I., Schmitt, O. (2016):
  Estimating the volume and age of water stored in global lakes using a geo-statistical approach. Nature
  Communications: 13603. doi: 10.1038/ncomms13603. Data is available at www.hydrosheds.org.
- Fields we rely on (TechDoc Table 2):
  - `Lake_type`: 1 = lake, 2 = reservoir, 3 = lake control. The default is 1, so small unidentified
    reservoirs are typed as lakes.
  - `Lake_name`: sparse; only filled for large lakes and GRanD reservoirs.
  - `Grand_id`
  - `Pour_long` / `Pour_lat`
  - There is **no** HydroRIVERS reach id. Lakes link to reaches only by position.
- Caveat: `Dis_avg` and `Res_time` are modeled (WaterGAP 1971–2000), so the rule 4 caveat applies if
  they are ever shown.
- GRanD (Global Reservoir and Dam database) has its own terms, which are **not verified**:
  https://www.globaldamwatch.org/grand showed only a warranty disclaimer. We only use `Lake_name` and
  `Grand_id` as delivered inside HydroLAKES, and we do not download GRanD itself until its terms are
  recorded here.

## IGN Argentina: SIG layers

- URLs:
  - Layers: https://www.ign.gob.ar/NuestrasActividades/InformacionGeoespacial/CapasSIG
  - Terms: https://www.ign.gob.ar/descargas/tyc1.html (read 2026-10-01)
- Relevant layers: "Aguas continentales" (watercourses, reservoirs, water bodies, canals), published as
  Shapefile, KML, GeoJSON and CSV, with a metadata PDF per layer.
- License: custom IGN terms ("Política de licenciamiento de datos"). It is **not** CC BY 4.0 and names
  no standard license. Conditions, verbatim:
  1. "Debe citarse la fuente de los documentos objeto de la reutilización: "FUENTE: Instituto Geográfico Nacional de la República Argentina"."
  2. "No se podrá indicar, insinuar o sugerir que el Instituto Geográfico Nacional, participa, patrocina o apoya la utilización o reutilización de la misma."
  3. "Deben conservarse, y por tanto no alterarse ni suprimirse los metadatos sobre la fecha de actualización y las condiciones de reutilización aplicables incluidos, en su caso, en el documento puesto a disposición para su utilización o reutilización."
  4. "En el caso de que se generen productos derivados, deberá además mencionarse la fecha de los datos originales del IGN."
  5. "Los datos descargados deben compartirse de manera libre y gratuita."
  6. "Se permite su uso comercial únicamente en el caso de obras derivadas en que la información sea utilizada como insumo para generar un nuevo producto."

  Also: "La reutilización puede incluir la copia, difusión, modificación, adaptación, extracción,
  reordenamiento y combinación de la información contenida en el sitio, siempre que su utilización no
  desnaturalice el sentido de la información." Liability is on the user ("bajo su propia cuenta y riesgo…").

- Commercial use: conditional (clause 6). The site is non-commercial and ships only derived tiles, so we
  believe we comply. A paywall or paid tier around IGN-derived data would conflict with clause 5.
- **Required attribution** (clause 1, verbatim): "FUENTE: Instituto Geográfico Nacional de la República
  Argentina". Show it in the in-map attribution and on the Phase 8 attributions page, with the date of the
  original IGN data (clause 4) and a statement that IGN does not endorse this product (clause 2). Do not
  alter the layers' update-date metadata (clause 3). Where the credit appears is our choice; the terms
  don't say.
- Citation: none provided beyond the credit line.
- Usage limits / API key: none stated on the terms page. The OGC services page
  (https://www.ign.gob.ar/NuestrasActividades/InformacionGeoespacial/ServiciosOGC) states no terms for
  the WMS/WFS endpoints.
- Not verified:
  - Date of the original data: needs the layer metadata PDFs or a fresh download (clause 4). The local
    copy's origin and download date are unknown.
  - Clause 5 can be read as "free redistribution only". Ask contacto@ign.gob.ar if monetization is ever
    planned.
  - How clause 3 applies to vector tiles, and whether the same terms cover data taken from the WFS.
  - The quoted text came through a page-to-text tool (checked twice, sentences matched). Confirm once in
    a browser before release.
- Local copy: `data/raw/ign/` (not downloaded by the pipeline).
  Six national layers in WGS84 (EPSG:4326) with attribute text in **ISO-8859-1** (per the `.cst`
  files; read with `open_options=['ENCODING=ISO-8859-1']`). Layer codes and `objeto` values:
  - BH140 `Corriente de agua` (river polygons)
  - BH130 `Embalse` (reservoirs)
  - `Espejo de agua perenne`
  - `Espejo de agua intermitente`
  - BI020 `Muro de embalse` (dam wall lines)
  - BH051 `Dique` (dam points)

  The six layers above were already there, origin and date unknown. There is no basin polygon in this
  copy. The two watercourse-line layers were downloaded by the project owner from the IGN layers page on
  2026-10-01 (date from the zip timestamps), as Shapefile, in WGS84 with the same ISO-8859-1 encoding.
  Columns: `gid`, `entidad`, `objeto` (`Corriente de agua`), `fna` (full name), `gna` (generic type),
  `nam` (short name), `sag` (`IGN`). `fna` is empty for 22% of the perennial lines.
  - `lineas_de_aguas_continentales_perenne/`: 50,093 lines nationally, 177,153 km
  - `lineas_de_aguas_continentales_intermitente/` (file `..._intermitentes.shp`): 271,755 lines, 479,230 km
    Their per-layer metadata PDFs (update date) were not downloaded, so clause 4's "date of the original
    data" is still open.

- Phase 5 use (2026-10-01), all derived into tiles and NDJSON, never redistributed raw:
  - Perennial lines: names for HydroRIVERS reaches (`fna`), a detail layer of lines HydroRIVERS lacks, and
    the names of the 15 approved rivers (owner decision: IGN spelling replaces the OpenStreetMap one).
  - `Embalse` (BH130, 28 polygons in the basin) and `Espejo de agua perenne` (1,011): names for HydroLAKES
    lakes, plus extra water bodies HydroLAKES lacks (691). `Dique` (BH051, 10 points) and `Muro de embalse`
    (BI020, 24 lines): dam positions and names. Counts from `data/work/ign-layers/report.json`.
  - Names are `fna` ("Embalse Alicurá", "Arroyo Blanco"), shown as IGN writes them.
- **Not verified, third-party source:** the BH130 `fdc` (source) field of the reservoir polygons says
  "Esri-World_Imagery_2010 / IGN04 / IGN Mapa Provincial…" (and "Dirección Provincial de Recursos Hídricos"
  for some). The outlines were digitized from Esri imagery; whether Esri's terms constrain data derived
  from it is not checked, and IGN publishes the layer under its own terms. Check with the layer
  metadata PDFs or contacto@ign.gob.ar before a public launch.
- **Date of the original data (clause 4): still open** (owner, 2026-10-01: later). The in-map credit and
  the panels carry the required "FUENTE: …" text and a no-endorsement note but no date yet.

## ALOS PALSAR RTC scene (ASF), local only

- Local copy: `data/raw/alos/AP_27847_PLR_F6470_RT1*` (origin unknown). ALOS PALSAR radiometric terrain
  corrected product processed by the Alaska Satellite Facility: HH/HV/VH/VV backscatter, 12.5 m DEM,
  incidence and layover/shadow maps. Acquired 2011-04-17, UTM 19S.
- Footprint 35.31°S–35.97°S, 70.57°W–71.12°W: **outside the Río Negro basin**, whose northern edge
  in the HydroBASINS delineation is 36.17°S (`data/work/basin/report.json`, 2026-09-30).
- Terms: **not verified.** The ISO metadata asks users to credit ASF processing and says "research
  agreements specify separate conditions by the Foreign Space Agencies" (JAXA for ALOS). Check ASF's
  data use terms before using any of it in the app.
- Not used by the pipeline.

## OpenStreetMap

- URL: https://www.openstreetmap.org/copyright
- License: Open Database License (ODbL) 1.0.
- Attribution: "© OpenStreetMap contributors", linked to the copyright page. The copyright page
  (read 2026-09-30) requires two things: credit OpenStreetMap, and make clear that the data is
  under the ODbL. It also says: "If you alter or build upon our data, you may distribute the result
  only under the same license."
- Use in Phase 1: `pipeline:osm-names` makes **one** Overpass request (overpass-api.de; the fair-use
  guidance is about 10,000 requests or 1 GB a day). It asks for the named waterways and water bodies
  in the basin bbox, and the response is cached in `data/work/osm-names/overpass.json`. The names are
  evidence for choosing the river names in `pipeline/names.json` by hand.
- Use in Phase 7: `pipeline:localities` makes one more Overpass request for the named
  `place=city|town|village` nodes in the basin bbox (cached in `data/work/localities/overpass.json`)
  and keeps those inside the basin polygon: 116 points, name and class only (no population). They are
  shipped in `public/tiles/localities.pmtiles`, so the tiles hold an extract of OSM data. The map's
  attribution line credits "© OpenStreetMap contributors", linked to the copyright page.
- Share-alike: `names.json` holds a few dozen river names, each confirmed by a person. We believe
  that is an insubstantial extract, which would not trigger share-alike, but this is **not
  verified**. The OSMF "Substantial – Guideline" on the OSM wiki needs reading before release. We
  attribute OSM either way (Phase 8 attributions page). The localities tiles (116 place nodes,
  name and class) are a larger extract than `names.json`; whether they count as a substantial
  extract is also **not verified**. Check the same guideline before release.

## Satellite imagery (EOxCloudless 2024, chosen in Phase 2)

The tile URL comes from `NEXT_PUBLIC_IMAGERY_TILE_URL`, so the provider can be swapped.

### EOX Sentinel-2 Cloudless (EOxCloudless)

- URLs:
  - https://cloudless.eox.at/
  - License: https://cloudless.eox.at/documentation/license
- License: CC BY-NC-SA 4.0 for non-commercial use. Commercial use needs the
  "EOX Commercial Attribution-RestrictedUse 1.2 License".
- Required attribution: "EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH
  (Contains modified Copernicus Sentinel data <year>)"
- Chosen 2026-09-30, on the condition that the site stays non-commercial.
- Endpoint: `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg`.
  It is the `s2cloudless-2024_3857` layer in the WMTS capabilities, and responses carry
  `access-control-allow-origin: *` and a 7-day cache (checked 2026-09-30). The layer abstract repeats
  the attribution and the CC BY-NC-SA 4.0 license.
- In the app, the attribution text is set in `NEXT_PUBLIC_IMAGERY_ATTRIBUTION` (see `.env.example`).
  It is always shown in the expanded map attribution control, because the license page says "for
  interactive maps, the credit should appear in the map interface".
- Open question: the documentation pages state **no usage limits or fair-use terms** for the free
  tile service. Ask EOX before a public launch with real traffic.

### Esri World Imagery

- License: **not verified.** Esri's terms and attribution pages could not be read on 2026-09-29.
- Believed: using it outside ArcGIS requires an ArcGIS Location Platform account/API key (free tier),
  and attribution "Esri, Maxar, Earthstar Geographics, and the GIS User Community" plus the dynamic
  credits.
- To check: developers.arcgis.com basemap attribution docs and the service's terms of use, before
  Phase 2.
