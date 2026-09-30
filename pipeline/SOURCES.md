# Data sources, licenses and attribution

Keep this file current (CLAUDE.md rule 9). A license counts as **verified** only when
someone has read the provider's own license text; the date says when. "Downloaded" is
taken from `pipeline/checksums.json` (UTC date), written by `pipeline:download`.

## Summary

| Source                                 | Used for                                                            | License                                                               | Commercial use                      | Verified   | Downloaded                        |
| -------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------- | ---------- | --------------------------------- |
| HydroRIVERS v1.0                       | River network geometry, topology                                    | HydroSHEDS v1 License Agreement (WWF), incl. Exhibit B attribution    | Yes                                 | 2026-09-29 | 2026-09-30                        |
| HydroBASINS v1c                        | Basin delineation, sub-basins                                       | HydroSHEDS v1 License Agreement (WWF), incl. Exhibit B attribution    | Yes                                 | 2026-09-29 | 2026-09-30                        |
| HydroATLAS v1 (RiverATLAS, BasinATLAS) | River/basin attributes (discharge, pop, etc.)                       | CC BY 4.0                                                             | Yes                                 | 2026-09-29 | 2026-09-30 (RiverATLAS only)      |
| GIRES v1.0 (non-perennial rivers)      | Flow-intermittence class per reach                                  | CC BY 4.0 per figshare metadata (README wording ambiguous, see below) | Yes, if CC BY                       | 2026-09-30 | 2026-09-30                        |
| IGN Argentina — SIG layers             | Watercourse names, extra detail (Phase 5)                           | **Not verified** (believed CC BY 4.0)                                 | Unknown                             | —          | —                                 |
| OpenStreetMap                          | River name evidence (Phase 1); localities, reservoirs, dams (later) | ODbL 1.0                                                              | Yes (share-alike on the database)   | 2026-09-30 | 2026-09-30 (Overpass, basin bbox) |
| Imagery: EOX Sentinel-2 Cloudless      | Candidate satellite basemap                                         | CC BY-NC-SA 4.0 (non-commercial); commercial needs an EOX license     | Only with an EOX commercial license | 2026-09-29 | n/a (tiles)                       |
| Imagery: Esri World Imagery            | Candidate satellite basemap                                         | **Not verified** (Esri terms of use)                                  | Unknown                             | —          | n/a (tiles)                       |

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
  (The authors and DOI are verified from the product page. The title and journal were written from memory; confirm them via the DOI.)
- Caveat (CLAUDE.md rule 4): discharge and population are modeled long-term averages
  (1971–2000) and do not reflect current dam regulation.

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

## IGN Argentina: SIG layers

- URL: https://www.ign.gob.ar/NuestrasActividades/InformacionGeoespacial/CapasSIG
- Relevant layers: "Aguas continentales", i.e. perennial and intermittent watercourses, published as
  Shapefile, KML, GeoJSON and CSV.
- License: **not verified.** The layers page links to "Términos y Condiciones", but it could not be
  fetched on 2026-09-29 (404 at the guessed URLs). We believe it is CC BY 4.0 with credit to
  "Instituto Geográfico Nacional de la República Argentina". To check, open the link from the layers
  page in a browser and record the exact text here before Phase 5 (the IGN gate).
- Local copy: `data/raw/ign/` (not downloaded by the pipeline; origin and download date unknown).
  Six national layers in WGS84 (EPSG:4326) with attribute text in **ISO-8859-1** (per the `.cst`
  files; read with `open_options=['ENCODING=ISO-8859-1']`). Layer codes and `objeto` values:
  - BH140 `Corriente de agua` (river polygons)
  - BH130 `Embalse` (reservoirs)
  - `Espejo de agua perenne`
  - `Espejo de agua intermitente`
  - BI020 `Muro de embalse` (dam wall lines)
  - BH051 `Dique` (dam points)

  There is **no watercourse-line layer and no basin polygon** in this copy. The Phase 5 gate needs the
  line layer downloaded.

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
- Share-alike: `names.json` holds a few dozen river names, each confirmed by a person. We believe
  that is an insubstantial extract, which would not trigger share-alike, but this is **not
  verified**. The OSMF "Substantial – Guideline" on the OSM wiki needs reading before release. We
  attribute OSM either way (Phase 8 attributions page).

## Satellite imagery (provider not chosen; decided in Phase 2)

The tile URL comes from `NEXT_PUBLIC_IMAGERY_TILE_URL`, so the provider can be swapped.

### EOX Sentinel-2 Cloudless (EOxCloudless)

- URLs:
  - https://cloudless.eox.at/
  - License: https://cloudless.eox.at/documentation/license
- License: CC BY-NC-SA 4.0 for non-commercial use. Commercial use needs the
  "EOX Commercial Attribution-RestrictedUse 1.2 License".
- Required attribution: "EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH
  (Contains modified Copernicus Sentinel data <year>)"
- Open questions:
  - which tile endpoint to use;
  - whether the public tile service has usage limits;
  - whether the site will stay non-commercial.

### Esri World Imagery

- License: **not verified.** Esri's terms and attribution pages could not be read on 2026-09-29.
- Believed: using it outside ArcGIS requires an ArcGIS Location Platform account/API key (free tier),
  and attribution "Esri, Maxar, Earthstar Geographics, and the GIS User Community" plus the dynamic
  credits.
- To check: developers.arcgis.com basemap attribution docs and the service's terms of use, before
  Phase 2.
