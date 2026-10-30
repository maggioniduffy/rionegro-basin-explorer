# Data sources, licenses and attribution

Keep this file current (CLAUDE.md rule 9). The public credits page (`/attributions`, data in
`lib/attributions.ts`) mirrors it: change both together. A license counts as **verified** only when
someone has read the provider's own license text; the date says when. "Downloaded" is
taken from `pipeline/checksums.json` (UTC date), written by `pipeline:download`.

## Summary

| Source                                                          | Used for                                                                                                                                                            | License                                                                                                                               | Commercial use                                                                                                                                                                                              | Verified                                          | Downloaded                                  |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------- |
| HydroRIVERS v1.0                                                | River network geometry, topology                                                                                                                                    | HydroSHEDS v1 License Agreement (WWF), incl. Exhibit B attribution                                                                    | Yes                                                                                                                                                                                                         | 2026-09-29                                        | 2026-09-30                                  |
| HydroBASINS v1c                                                 | Basin delineation, sub-basins                                                                                                                                       | HydroSHEDS v1 License Agreement (WWF), incl. Exhibit B attribution                                                                    | Yes                                                                                                                                                                                                         | 2026-09-29                                        | 2026-09-30                                  |
| HydroATLAS v1 (RiverATLAS, BasinATLAS)                          | River/basin attributes (discharge, pop, etc.)                                                                                                                       | CC BY 4.0                                                                                                                             | Yes                                                                                                                                                                                                         | 2026-09-29                                        | 2026-09-30 (RiverATLAS only)                |
| GIRES v1.0 (non-perennial rivers)                               | Flow-intermittence class per reach                                                                                                                                  | CC BY 4.0 per figshare metadata (README wording ambiguous, see below)                                                                 | Yes, if CC BY                                                                                                                                                                                               | 2026-09-30                                        | 2026-09-30                                  |
| HydroLAKES v1.0                                                 | Lake and reservoir polygons (line clipping, mask, outlines)                                                                                                         | CC BY 4.0                                                                                                                             | Yes                                                                                                                                                                                                         | 2026-09-30                                        | 2026-09-30                                  |
| IGN Argentina — SIG layers                                      | Watercourse names, detail lines, lake names and extra lakes, dams (Phase 5)                                                                                         | IGN "Términos y Condiciones" (custom, no named license; **not** CC BY)                                                                | Only for derived works; non-commercial use is fine                                                                                                                                                          | 2026-10-01 (terms read; layer metadata not)       | — (local copy origin unknown)               |
| IGN Argentina — Provincia                                       | Province boundary (Córdoba scope, R2)                                                                                                                               | IGN "Términos y Condiciones" (same as above)                                                                                          | Only for derived works; non-commercial use is fine                                                                                                                                                          | 2026-10-11 (terms and layer metadata)             | 2026-10-12                                  |
| APRHI Córdoba (PIHC) water layers                               | Córdoba basins, sub-basins, management units, streams, dams, lakes (R2–R3)                                                                                          | PIHC "Términos y Condiciones" (custom, no named license; **not** CC BY)                                                               | Only for derived works; non-commercial use is fine                                                                                                                                                          | 2026-10-11 (terms PDF; per-layer origin not)      | 2026-10-10 (owner, from the PIHC)           |
| OpenStreetMap                                                   | River name evidence (Phase 1); localities (Phase 7); reservoirs, dams (later); the "Mapa" base map from 2026-10-12 to 2026-10-13 (replaced by Terrain Tiles relief) | ODbL 1.0                                                                                                                              | Yes (share-alike on the database)                                                                                                                                                                           | 2026-09-30                                        | 2026-09-30 (Overpass, basin bbox)           |
| Terrain Tiles (AWS Open Data, Tilezen)                          | The "Mapa" base: client-side hillshade (MapLibre `raster-dem`, `elevation-tiles-prod/terrarium`, no key, nothing stored)                                            | No named license: joerd `docs/attribution.md` credits (SRTM, GMTED2010 public domain; NOAA ETOPO1)                                    | Yes, with the credit (no non-commercial clause found)                                                                                                                                                       | 2026-10-13                                        | n/a (tiles)                                 |
| Sentinel-2 L2A COGs (Earth Search v1, AWS `sentinel-cogs`)      | Offline input of `pipeline:flow-water` (F2): water mask, channel network and reservoir polygons; only derived vectors are published                                 | Copernicus Sentinel data legal notice (EC): free, full and open; attribution required                                                 | Yes (no non-commercial clause)                                                                                                                                                                              | 2026-10-18                                        | n/a (windowed reads, cached in `data/work`) |
| Copernicus DEM GLO-30 (AWS `copernicus-dem-30m`, GLO-30 Public) | Offline input of `pipeline:flow-water` (F2): branch orientation fallback; only derived vectors are published                                                        | "Licence for the use of the Copernicus WorldDEM-30" (COP-DEM-GLO-30-F, Full, Free & Open; ESA/EU/Airbus/DLR); read in full 2026-10-18 | Yes (no non-commercial clause); attribution plus liability notice required. Caveat: a generic ESA "restrictive terms" licence linked from the same Data Space page has a non-commercial clause; see section | 2026-10-18                                        | n/a (windowed reads, cached in `data/work`) |
| Imagery: EOX Sentinel-2 Cloudless                               | Satellite basemap (chosen)                                                                                                                                          | CC BY-NC-SA 4.0 (non-commercial); commercial needs an EOX license                                                                     | Only with an EOX commercial license                                                                                                                                                                         | 2026-09-29                                        | n/a (tiles)                                 |
| Imagery: IGN Argentina `mosaicos_vuelos` (WMTS)                 | High-zoom aerial imagery above EOX, `nqn` only (chosen I1.1; wired in I1.2)                                                                                         | IGN download "Términos y Condiciones" (no imagery-specific terms found)                                                               | Only for derived works; non-commercial use is fine                                                                                                                                                          | 2026-10-19 (terms via summarizer; service probed) | n/a (tiles)                                 |
| Imagery: Esri World Imagery                                     | Rejected (I1.0)                                                                                                                                                     | Esri terms; ArcGIS Location Platform key                                                                                              | Billed above 2M tiles/month                                                                                                                                                                                 | 2026-10-19 (pricing via summarizer)               | n/a (tiles)                                 |
| LLM: Groq (`openai/gpt-oss-20b`)                                | Ask box: routes a question to an existing id (no data shown)                                                                                                        | Groq terms (service, not data)                                                                                                        | n/a                                                                                                                                                                                                         | 2026-10-10 (training clause not verified)         | n/a (API)                                   |
| Open-Meteo Flood API (GloFAS v4, Copernicus CEMS)               | E1: daily river discharge (forecast + p25/p75, 1984–2022 reanalysis mean) at 3 gauge cells in `cba`; scaled to reaches                                              | Open-Meteo data CC BY 4.0; GloFAS under the CEMS-FLOODS datasets licence (rev. 1)                                                     | Open-Meteo free API: non-commercial only (no subscriptions or ads); CEMS-FLOODS: no non-commercial clause seen                                                                                              | 2026-10-29 (caching, derived data not verified)   | n/a (API)                                   |
| Rate limit/cache: Upstash Redis                                 | Ask box rate limit and shared cache                                                                                                                                 | Upstash terms (service, not data)                                                                                                     | n/a                                                                                                                                                                                                         | 2026-10-10 (overage terms not stated)             | n/a (API)                                   |

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
  - `ria_ha_csu` (hectares, river area within the reach's catchment): Phase F1 (2026-10-18) uses it
    for the "estimated width" band of a flow section where no IGN channel outline exists:
    width = `ria_ha_csu` × 10,000 / (`LENGTH_KM` × 1000) m. Modeled, and it can include small
    tributaries in the catchment; the flow panel labels it "Estimated width (RiverATLAS river area,
    modeled)". Same CC BY 4.0 citation as above (Linke et al., 2019).
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
  - BH140 `Corriente de agua` (river polygons). Used since Phase F1 (2026-10-18) by
    `pipeline:flow-sections` for the wet span across the channel of each `nqn` flow section; the
    attribution already shown for IGN covers it (no new source).
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

## IGN Argentina: Provincia (provincial boundaries)

- URLs:
  - Layer: https://www.ign.gob.ar/NuestrasActividades/InformacionGeoespacial/CapasSIG (Geodesia y
    demarcación > Límites > Provincia)
  - Download (the page's "Descargar Capa", Shapefile):
    `https://dnsg.ign.gob.ar/apps/api/v1/capas-sig/Geodesia+y+demarcaci%C3%B3n/L%C3%ADmites/provincia/shp`
    (the `/geojson` variant answered 500 on 2026-10-12)
  - Metadata: https://www.ign.gob.ar/capas-sig/metadata/provincia.pdf (kept next to the zip)
- License: the IGN terms above (https://www.ign.gob.ar/descargas/tyc1.html). The layer metadata adds,
  verbatim: "Libre uso de la información, cumpliendo con la cita adecuada del Instituto Geográfico
  Nacional." The stricter tyc1 clauses apply (credit, no endorsement, original data date, free sharing).
- Required attribution: "FUENTE: Instituto Geográfico Nacional de la República Argentina".
- Date of the original data (clause 4): metadata "Fecha de creación: 26-04-2019", "Última
  actualización: 09-09-2019"; the files inside the zip are dated 2024-04-19.
- Local copy: `data/raw/ign/provincia/provincia.zip` (24 polygons, WGS84, attributes in **UTF-8** per
  the `.cpg`, unlike the older IGN layers; name field `fna`), downloaded 2026-10-12 (UTC),
  sha256 `f7b6058cc754b59aabc6ddbec09ba5250f4570bb30b3c597c8b4d14048251223`. Not fetched by the
  pipeline.
- Use: the Córdoba polygon is the province boundary for the R2 inside/outside areas (164,670 km² in
  EPSG:6933). Not drawn on the map so far (provincial boundaries were dropped for `nqn`, Phase 5).

## APRHI Córdoba: Portal de Información Hídrica de Córdoba (PIHC) water layers

- Provider: Administración Provincial de Recursos Hídricos de Córdoba (APRHI), Gobierno de la
  Provincia de Córdoba. Published on ArcGIS under the account `APRHI_2018`, as part of the PIHC
  (http://pihc.aprhi.gob.ar/, https://sihm-aprhi.opendata.arcgis.com/).
  - Experience "Cuencas, Subcuencas y Unidades de Gestión Hídrica-Pública":
    https://experience.arcgis.com/experience/95e75e89032d42898e91c31a3df99cda/
  - Cuencas service (data date 24/10/2019, "FUENTE DEL DATO: Área de Manejo y Gestión Integral de las
    Cuencas"): https://services1.arcgis.com/atxllciEI8CHWvwW/arcgis/rest/services/Cuencas_HidrográficasPUBLICA/FeatureServer
  - Unidades de Gestión Hídrica (data date 23/12/2019, "PRODUCTOR: APRHI"):
    https://services1.arcgis.com/atxllciEI8CHWvwW/arcgis/rest/services/UGHvista_pulica/FeatureServer
  - "CPA" in the layer names: meaning not found.
- License: the PIHC "Términos y Condiciones de uso de la información" (APRHI, PDF linked from each item
  as "RESTRICCIONES: Restricciones de uso":
  https://drive.google.com/file/d/15Y-D80ZX6puQtapwDAJ294jUYymjPYzx/view; read 2026-10-11 with
  `pdftotext`). Its "Política de licenciamiento de datos" mirrors IGN's clause by clause. Verbatim:
  1. "Debe citarse la fuente de los documentos objeto de la reutilización: "FUENTE: Portal de Información Hídrica de Córdoba"."
  2. "Los datos descargados no deben alterarse."
  3. "No se podrá indicar, insinuar o sugerir que la APRHI, participa, patrocina o apoya la utilización o reutilización de la misma."
  4. "Deben conservarse, y por tanto no alterarse ni suprimirse los metadatos sobre la fecha de actualización y las condiciones de reutilización aplicables incluidos, en su caso, en el documento puesto a disposición para su utilización o reutilización."
  5. "En el caso de que se generen productos derivados, deberá además mencionarse la fecha de los datos originales señalados en el PIHC."
  6. "Los datos descargados deben compartirse de manera libre y gratuita."
  7. "Se permite su uso comercial únicamente en el caso de obras derivadas en que la información sea utilizada como insumo para generar un nuevo producto."

  Also: "La reutilización autorizada puede incluir la copia, difusión, modificación, adaptación,
  extracción, reordenamiento y combinación de la información contenida en el sitio, siempre que su
  utilización no desnaturalice el sentido de la información." The header adds: "Debe reconocerse la
  autoría del material que se publica en él a la Administración Provincial de Recursos Hídricos de
  Córdoba, salvo que se exprese lo contrario." Problems go to sig.aprhi@cba.gov.ar.

- Reading: clause 2 ("no deben alterarse") sits next to an explicit permission to modify, adapt,
  extract and combine. We read it as "don't misrepresent the data": clipping, simplifying into tiles
  and joining to other sources keep the meaning. Not confirmed with APRHI; ask sig.aprhi@cba.gov.ar
  before a public launch, together with the meaning of "CPA".
- Commercial use: conditional (clause 7), as for IGN. The site is free and non-commercial.
- **Required attribution:** "FUENTE: Portal de Información Hídrica de Córdoba", authorship to the
  Administración Provincial de Recursos Hídricos de Córdoba (APRHI), the date of the original data
  (clause 5) and a statement that APRHI does not endorse this product (clause 3). Add it to
  `/attributions` (`lib/attributions.ts`) when `cba` is served.
- Local copy (owner, 2026-10-10, zips in `data/raw/`, not fetched by the pipeline). CRS POSGAR 98
  Argentina zone 4 (`.prj`; GDAL reports EPSG:22174, same projection to ~1e-9°), except `Salinas`
  (POSGAR 94). The `.shp.xml` files carry no license or publisher, only dates (`mdDateSt` 20231201,
  `CreaDate` 20251105).
  - `Cuencas_CPA` (6 basins clipped to Córdoba, 164,709 km²), `CuencasInterprovinciales_CPA` (the same
    6 unclipped, 620,325 km²), `Subcuencas_cpa` (25), `UnidadesDeGestion_hidrica_CPA` (80 units and 1
    empty row), `SubcuencasEmbalses_CPA` (71 dam catchments).
  - `CursosDeAgua_CPA` (4,241 lines, 24,647 km, 77 % of km named, not a noded network, 49 % "En
    revisión"), `CuerposDeAguaNaturales_CPA` (1,611 polygons), `Embalses_CPA` (27 reservoirs),
    `Salinas` (Salinas Grandes, Salinas de Ambargasta), `Lineas_de_ribera` (250 riparian-line records).
- **Provenance (owner, 2026-10-12):** every zip was exported from APRHI's own Experience above. Services with
  the same names as `CursosDeAgua_CPA`, `CuerposDeAguaNaturales_CPA` and `Embalses_CPA` also exist in a
  student account (`NGS_main_gengeo`, a 2025 course, re-derived from Landsat 8 and IGN maps, no license); they
  are not the source.
- Not hydrology: no discharge, population or upstream area per river. `Altura_*` attributes come from
  IGN's 30 m DEM (item description), so IGN's terms apply to them too.

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
  evidence for choosing the river names in `regions/nqn/names.json` by hand.
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

## Terrain Tiles (AWS Open Data; Tilezen joerd), terrarium encoding

- URLs: https://registry.opendata.aws/terrain-tiles/ ;
  https://github.com/tilezen/joerd/blob/master/docs/attribution.md ;
  https://github.com/tilezen/joerd/blob/master/docs/data-sources.md
- Endpoint: `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png` (256 px). Tested
  2026-10-13: HTTP 200 with no key, `Access-Control-Allow-Origin: *`.
- Used for (2026-10-13): the "Mapa" base, a hillshade MapLibre draws from these tiles over a plain land
  colour. Relief only, no towns, roads, rivers or land cover. Nothing is downloaded or stored by the
  pipeline. Source `maxzoom` 12 (SRTM is 30 m, finer zooms are oversampled).
- License: no named license. The registry's License field points to `attribution.md`: "Attribution is
  required for many terrain tile data providers." The sources that cover our regions are public domain:
  SRTM ("No domestic copyright will be asserted.") and GMTED2010 ("No restrictions"); ETOPO1 (NOAA) at
  zooms 0–3. That mapping to Argentina is inferred from `data-sources.md`, which does not name it.
- Required credit, verbatim from the "Required attribution" block (the lines for our regions):
  "Global ETOPO1 terrain data U.S. National Oceanic and Atmospheric Administration" and "United States
  3DEP (formerly NED) and global GMTED2010 and SRTM terrain data courtesy of the U.S. Geological Survey."
  Shown in the map attribution control and on /attributions (`BASEMAP_CREDIT`).
- The extra "Mapzen" credit is listed only "when using Mapzen's hosted service"; we read from AWS S3, so
  it is not shown (our reading, not stated).
- No usage limits, key or SLA are stated; the data is static ("Regular updates are not planned").
- Rejected the same day: Esri World Shaded Relief. Esri's terms summary says use outside Esri software
  needs an ArcGIS Online subscription, and the layer retires in March 2028.

## Sentinel-2 L2A and Copernicus DEM GLO-30 (AWS Open Data), read offline (F2)

Read by `pipeline:flow-water` (phase F2) in windows around each flow section's course; raw pixels are cached in
`data/work/<region>/flow-water/cache/` (gitignored) and never redistributed. Only derived vectors are written.
Terms read 2026-10-18.

### Sentinel-2 L2A COGs (Element84 Earth Search v1)

- URLs:
  - STAC: https://earth-search.aws.element84.com/v1 (collection `sentinel-2-l2a`; its record says
    `"license":"proprietary"` and links the legal notice below)
  - Registry: https://registry.opendata.aws/sentinel-2-l2a-cogs/ (bucket `sentinel-cogs`, us-west-2; managed by Element 84)
  - Terms: https://sentinels.copernicus.eu/documents/247904/690755/Sentinel_Data_Legal_Notice (read in full)
- License: "users shall have a free, full and open access to Copernicus Sentinel Data ... without any express or
  implied warranty". Permitted: "reproduction; distribution; communication to the public; adaptation, modification
  and combination with other data and information". No non-commercial clause.
- Required attribution for modified data (verbatim): "Contains modified Copernicus Sentinel data [Year]", the year
  being the acquisition year of the scenes used (the notice does not define it for multi-date composites; we use
  the year range). It goes into `/attributions` when F3 publishes the network.
- Citation (AWS registry): "Sentinel-2 Cloud-Optimized GeoTIFFs was accessed on DATE from
  https://registry.opendata.aws/sentinel-2-l2a-cogs."
- Access: no account or key; anonymous STAC and S3. No usage limits stated.
- Scale and offset: item `raster:bands` list scale 0.0001 and offset -0.1 (the -1000 DN BOA offset of
  baseline 04.00 or later; collection `item_assets` say offset 0). But items also carry `earthsearch:boa_offset_applied: true`
  (checked 2026-10-18 on `S2A_19HES_20240426_0_L2A`, baseline 05.10, assets in `sentinel-cogs`): the DN is
  already harmonised, and adding -0.1 again puts open water below zero (green about -0.05, SWIR -0.08 on
  limay-096). The step reads scale per item and zeroes the offset when that flag is true; the lock records
  both the listed and the applied offset.

### Copernicus DEM GLO-30 (`copernicus-dem-30m`)

- URLs:
  - Registry: https://registry.opendata.aws/copernicus-dem/ (managed by Sinergise; hosts GLO-30 Public: "limited
    worldwide coverage" because "a small subset of tiles covering specific countries are not yet released to the
    public by the Copernicus Programme")
  - Readme: https://copernicus-dem-30m.s3.amazonaws.com/readme.html
  - Collection page: https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM
  - Licence (read in full 2026-10-18): https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Data/DEM/resources/license/License-COPDEM-30.pdf
    ("Licence for Copernicus DEM instance COP-DEM-GLO-30-F Global 30m Full, Free & Open")
- License, Art. 4: "The Licensor grants to the User the following non-exclusive rights of use regarding the Copernicus
  WorldDEM-30: (a) reproduction; (b) distribution; (c) communication to the General Public; (d) adaptation,
  modification and combination with other data and information." Art. 5: "The use rights granted under this licence
  are free of charge to the User." Art. 3: "worldwide and without limitation in time". No non-commercial clause, so
  commercial use is allowed. The General Public is "any natural or legal person".
- Required attribution for modified data (Art. 6(b), verbatim): "produced using Copernicus WorldDEM-30 © DLR e.V.
  2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA;
  all rights reserved". Required liability notice (Art. 6(c), verbatim, translation allowed): "The organisations in
  charge of the Copernicus programme by law or by delegation do not incur any liability for any use of the Copernicus
  WorldDEM-30". Art. 6(d): do not suggest official endorsement by the Provider, the Licensor or Copernicus.
  Both texts go into `/attributions` when F3 publishes the network. The licence sets no placement.
- Citation (AWS registry): "Copernicus Digital Elevation Model (DEM) was accessed on DATE from
  https://registry.opendata.aws/copernicus-dem." DOI https://doi.org/10.5270/ESA-c5d3d65.
- Open point: the Data Space page also links a generic ESA licence for "data subject to restrictive licensing terms"
  (issue date 21/02/2025; https://dataspace.copernicus.eu/sites/default/files/media/files/2025-06/copernicus_contributing_mission_data_access_v2_cop_dem_licenses.pdf)
  whose 3.4.3 limits general-public use to "non-commercial activities". It does not name GLO-30 and conflicts with
  the GLO-30 licence above. We follow the GLO-30 licence. We publish only derived vectors, never DEM pixels. Confirm
  with the Copernicus helpdesk if the site becomes commercial.
- Access: no account or key. 1 x 1 degree COGs `Copernicus_DSM_COG_10_<S..>_00_<W...>_00_DEM/`; tile S39 W069
  answered HTTP 200 on 2026-10-18. The DEM only breaks orientation ties, so a missing tile degrades to the course
  tangent. No usage limits stated.
- Status: licence read; the registry, readme and collection pages were read through a summarizer.

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

- **Rejected in I1.0 (2026-10-19).** Pricing read through a summarizer: 2M basemap tiles/month free, then
  $0.15 per 1,000, not hard-capped (https://developers.arcgis.com/pricing/), so it can bill with traffic
  (Rule 8). Needs an ArcGIS Location Platform API token. Tracing rights for a non-ArcGIS workflow not verified.
- Attribution if ever used: "Esri, Maxar, Earthstar Geographics, and the GIS User Community", plus
  "Powered by Esri".

### IGN Argentina: `mosaicos_vuelos` (aerial orthomosaics), chosen in I1.1 for `nqn`

- Service: WMTS `https://imagenes.ign.gob.ar/geoserver/gwc/service/wmts?REQUEST=GetCapabilities`, layer
  `mosaicos_vuelos`, PNG, EPSG:3857 matrices up to z20. REST template:
  `https://imagenes.ign.gob.ar/geoserver/gwc/service/wmts/rest/mosaicos_vuelos/default/EPSG:3857/EPSG:3857:{z}/{y}/{x}?format=image/png`.
  Listed on https://www.ign.gob.ar/NuestrasActividades/InformacionGeoespacial/ServiciosOGC.
- Probed 2026-10-19: no key; responses carry `access-control-allow-origin` echoing the request `Origin`
  (snapshot export works). Coverage is **patchy**: imagery at Choele Choel, the Limay at Neuquén and Allen
  (sharp aerial photo at z16); empty 852-byte tiles at El Chocón. Footprint over the basin not mapped yet.
  The sibling layer `mosaicos_vuelos_vant` is almost empty over the basin.
- Terms: no imagery-specific terms found. The IGN download terms (https://www.ign.gob.ar/descargas/tyc1.html,
  read through a summarizer, same terms as the SIG layers above) allow derived works, including tracing,
  ask to keep the original date and metadata and to share derived data free of charge.
- Required credit: "FUENTE: Instituto Geográfico Nacional de la República Argentina". It goes on the map
  attribution, the snapshot strip and `/rionegro/attributions` when I1.2 wires the layer.
- Cost: none stated; no key, no traffic tier. Ask IGN before a public launch with real traffic.

### Other imagery candidates checked in I1.0 (2026-10-19, not used)

- MapTiler Satellite (plan B): Free plan is non-commercial and hard-capped (5k sessions/month, then paused,
  no billing); allows "derivative vector datasets for non-commercial purposes"; forbids server-side caching,
  proxying and bulk download; "© MapTiler" plus logo required (https://www.maptiler.com/cloud/pricing/,
  https://www.maptiler.com/terms/cloud/). Resolution over Argentina not verified (2 m "elsewhere").
- Mapbox Satellite: 750k raster tiles/month free, then $0.25 per 1,000 (https://www.mapbox.com/pricing);
  tracing licensed only for OpenStreetMap (https://docs.mapbox.com/data/tilesets/guides/imagery/). Rejected.
- IDE Neuquén, IDERN (Río Negro), CONAE high-resolution mosaic: no ≤2 m layer with coverage and terms
  verified. Planet NICFI: 30°N–30°S only, 4.77 m. Google, Bing: terms forbid this use without their SDK/key.

## Services for the ask box (Phase 7, 2026-10-10)

Not data sources: these services route a typed question to an id that already exists in Mongo.
No value from them is ever shown. Terms were read on the providers' pages on 2026-10-10
(license-checker agent); the points marked **not verified** need the owner's console.

### Groq (default LLM, `LLM_PROVIDER=groq`, model `openai/gpt-oss-20b`)

- Data: "By default, Groq does not retain customer data for inference requests." Logs are kept
  up to 30 days only for reliability or abuse; Zero Data Retention can be turned on in Data
  Controls (https://console.groq.com/docs/your-data). Data is stored in US GCP.
- Training on API inputs: **not verified** (the privacy policy excludes data processed for
  customers; the services agreement was not read). Check Groq's terms or Trust Center.
- Free-plan limits: **not verified.** The rate-limits page shows 30 RPM / 1K RPD / 200K TPD for
  `openai/gpt-oss-20b` under "Developer plan"; check https://console.groq.com/settings/limits.
- Owner to do: confirm the two points above and turn on Zero Data Retention.

### Google Gemini API (optional, `LLM_PROVIDER=gemini`, model `gemini-3.5-flash-lite`)

- Free (unpaid) tier: Google "uses the content you submit to the Services and any generated
  responses to provide, improve, and develop" its products, and human reviewers may read them
  (https://ai.google.dev/gemini-api/terms).
- **Not usable for this site on the free tier:** the same terms say "You may use only Paid
  Services when making API Clients available to users in the European Economic Area" (also UK
  and Switzerland). A public site gets EU visitors, so Gemini needs a paid key (recurring cost,
  rule 8) or must stay off.
- Free-tier RPM/RPD: **not verified** (only shown in Google AI Studio).

### Upstash Redis (rate limit and shared cache for `/api/ask`)

- Free tier: 250 MB, 500K commands per month, 1 database, 10 GB bandwidth
  (https://upstash.com/pricing/redis). Writes are rejected when the store is full.
- What happens past 500K commands, and whether the free plan needs a card: **not stated.** Check
  in the console before creating the database. Vercel KV no longer exists; it moved to Upstash via
  the Vercel Marketplace in December 2024 (https://vercel.com/docs/redis).
- Stored: hashed client IPs (salted SHA-256) as rate-limit keys and hashed questions as cache keys,
  never raw IPs or question text.

## Open-Meteo Flood API (GloFAS v4), Phase E1 (2026-10-29)

- Provider: Open-Meteo (https://open-meteo.com/en/docs/flood-api), endpoint
  `https://flood-api.open-meteo.com/v1/flood`. Serves GloFAS v4 (Copernicus Emergency Management Service),
  simulated daily river discharge on a 0.05° (~5 km) grid: forecast up to 30 days with ensemble statistics
  (`river_discharge_p25`, `_p75`, ...), reanalysis 1984 to July 2022. Units m³/s. Values are **modelled**.
- Cell choice: the API picks "the largest river in a 5 km area"; cells for `cba` gauges are hand-checked and fixed
  in `regions/cba/effluent.config.json` (see DECISSIONS.md, Phase E1).
- Licenses (read 2026-10-29 by the license-checker agent; quotes to re-check on the pages):
  - Open-Meteo data: CC BY 4.0 (https://open-meteo.com/en/licence): credit with a link next to the data,
    example `<a href="https://open-meteo.com/">Weather data by Open-Meteo.com</a>`, link to the licence, and say
    the values were changed.
  - GloFAS: CEMS-FLOODS datasets licence (https://ewds.climate.copernicus.eu/licences/cems-floods). Notice for
    adapted data: "Contains modified Copernicus Emergency Management Service information [Year]" (unmodified:
    "Generated using Copernicus Emergency Management Service information [Year]"). Our values are scaled, so the
    "modified" notice applies.
- Terms (https://open-meteo.com/en/terms): "You may only use the free API services for non-commercial
  purposes", e.g. non-profit sites "that do not have subscriptions or advertising". Free limits: 600/minute,
  5,000/hour, 10,000/day, 300,000/month per IP; long date ranges count as several calls (a 1984–2022 request
  hit the minutely limit after ~10 calls on 2026-10-29).
- **Not verified:** whether caching responses (we cache ~3 h) is allowed; how derived pollutant concentrations are
  treated. Check with Open-Meteo / ECMWF before any commercial use.
- Attribution in the app: both notices, in the effluent panel and on `/attributions` (`lib/attributions.ts`).

## Parameter references for the effluent model, Phase E1 (2026-10-29)

Not datasets: published values used as model defaults or ranges. Each default in
`regions/cba/effluent.config.json` names one of these.

- Decreto 847/2016, Provincia de Córdoba (https://www.cba.gov.ar/wp-content/4p96humuzp/2014/07/Vertido-de-Efluentes-Decreto-847.pdf),
  Annex I amended by Res. APRHI 31/2022 (B.O. 08/07/2022): DBO₅ 40 mg/L; total P ≤ 0.5 mg/L for lakes, reservoirs and
  their tributaries. **Not verified:** the thermotolerant coliform limit (annex tables are images) and the Res.
  General 3/2025 values for P and ammonia N. No receiving-water DO objective exists.
- EDAR Bajo Grande: about 2.8 m³/s design capacity (two 5,000 m³/h modules, press reports 2022). No published
  effluent BOD or coliform data; outfall location not verified.
- Embalse San Roque: INA‑CIRSA Limnología 20 (https://www.ina.gob.ar/archivos/publicaciones/Cirsa-Limnologia-20-eutrofico-san-roque.pdf)
  and ILEC (https://wldb.ilec.or.jp/Display/html/3391): 16 km², 190 hm³, mean depth 13 m, inflows ≈ 5.25 m³/s,
  TP load ≈ 190 t/yr (ILEC), residence 0.1–0.7 yr (ILEC) vs ≈ 1.1 yr from volume/inflow.
- Coefficients: Chapra (1997) _Surface Water-Quality Modeling_; Bowie et al. (1985) EPA/600/3-85/040; OECD (1982)
  eutrophication model and trophic boundaries; Leopold & Maddock (1953) USGS PP 252; Manning n 0.03–0.05 from the
  UNC report on Suquía/Cosquín/San Antonio rating curves (Grosso Ribero, Olivieri, Viotti, Aug 2026; shared by the
  owner, citation pending their permission).
- DO threshold 5 mg/L and coliform threshold 200 /100 mL (US EPA 1976 _Quality Criteria for Water_, primary
  contact) are **assumptions**, editable in the panel.
