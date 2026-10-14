/**
 * Data sources credited on /attributions, mirroring pipeline/SOURCES.md (keep both in
 * sync). Names, license titles, citations and required notices are quoted as the
 * providers publish them, so they are not translated; the prose around them lives in
 * messages (attributions.*), keyed by `id`.
 */
import type { KnownRegionId } from "@/regions";
import { BASEMAP_CREDIT } from "./map/config";

export type SourceId =
  | "hydrosheds"
  | "hydroatlas"
  | "gires"
  | "hydrolakes"
  | "ign"
  | "aprhi"
  | "osm"
  | "terrain"
  | "eox";

export type Source = {
  id: SourceId;
  name: string;
  url: string;
  license: { name: string; url: string };
  /** Text the license asks to show, verbatim. */
  credit?: string;
  /** Long notice the license asks to reproduce, verbatim (English only). */
  notice?: string;
  citations: { text: string; url?: string }[];
  /** Messages key (under attributions.sources) of "Used for", when not `<id>.usedFor`. */
  usedForKey?: "ign.usedForCba";
};

/** HydroSHEDS v1 License Agreement, Exhibit B (SOURCES.md), with the product name filled in. */
const hydroshedsNotice = (product: string) =>
  `This product ${product} incorporates data from the HydroSHEDS version 1 database which is © World Wildlife Fund, Inc. (2006-2022) and has been used herein under license. WWF has not evaluated the data as altered and incorporated within ${product}, and therefore gives no warranty regarding its accuracy, completeness, currency or suitability for any particular purpose. Portions of the HydroSHEDS v1 database incorporate data which are the intellectual property rights of © USGS (2006-2008), NASA (2000-2005), ESRI (1992-1998), CIAT (2004-2006), UNEP-WCMC (1993), WWF (2004), Commonwealth of Australia (2007), and Her Royal Majesty and the British Crown and are used under license. The HydroSHEDS v1 database and more information are available at https://www.hydrosheds.org.`;

const CC_BY_4 = {
  name: "CC BY 4.0",
  url: "https://creativecommons.org/licenses/by/4.0/",
};

/**
 * APRHI's PIHC water layers (SOURCES.md, Córdoba): the terms ask for the "FUENTE" line, the
 * date of the original data and no suggestion that APRHI endorses the product (the last is
 * attributions.sources.aprhi.terms).
 */
const APRHI: Source = {
  id: "aprhi",
  name: "Portal de Información Hídrica de Córdoba (APRHI)",
  url: "http://pihc.aprhi.gob.ar/",
  license: {
    name: "PIHC Términos y Condiciones de uso de la información",
    url: "https://drive.google.com/file/d/15Y-D80ZX6puQtapwDAJ294jUYymjPYzx/view",
  },
  credit:
    "FUENTE: Portal de Información Hídrica de Córdoba. Administración Provincial de Recursos Hídricos de Córdoba (APRHI). Original data: Cuencas 24/10/2019, Unidades de Gestión Hídrica 23/12/2019; CursosDeAgua, CuerposDeAguaNaturales and Embalses as published on the PIHC in October 2026.",
  citations: [],
};

/** The sources a region credits, with its product name in the HydroSHEDS notice. */
export function sourcesFor(region: KnownRegionId, product: string): Source[] {
  const all = SOURCES.map((s) =>
    s.id === "hydrosheds" ? { ...s, notice: hydroshedsNotice(product) } : s,
  );
  if (region !== "cba") return all;
  // Córdoba: APRHI comes first among the agencies (precedence APRHI > IGN > HydroRIVERS),
  // and IGN is used outside the province.
  return all.flatMap((s) =>
    s.id === "ign" ? [APRHI, { ...s, usedForKey: "ign.usedForCba" }] : [s],
  );
}

const SOURCES: Source[] = [
  {
    id: "hydrosheds",
    name: "HydroRIVERS v1.0 and HydroBASINS v1c (HydroSHEDS)",
    url: "https://www.hydrosheds.org",
    license: {
      name: "HydroSHEDS v1 License Agreement",
      url: "https://data.hydrosheds.org/file/technical-documentation/HydroSHEDS_TechDoc_v1_4.pdf",
    },

    citations: [
      {
        text: "Lehner, B., Verdin, K., Jarvis, A. (2008): New global hydrography derived from spaceborne elevation data. Eos, Transactions, AGU, 89(10): 93–94.",
      },
      {
        text: "Lehner, B., Grill, G. (2013): Global river hydrography and network routing: baseline data and new approaches to study the world's large river systems. Hydrological Processes, 27(15): 2171–2186.",
      },
    ],
  },
  {
    id: "hydroatlas",
    name: "RiverATLAS v1.0 (HydroATLAS)",
    url: "https://www.hydrosheds.org/products/hydroatlas",
    license: CC_BY_4,
    citations: [
      {
        text: "Linke, S., Lehner, B., Ouellet Dallaire, C., Ariwi, J., Grill, G., Anand, M., Beames, P., Burchard-Levine, V., Maxwell, S., Moidu, H., Tan, F., Thieme, M. (2019): Global hydro-environmental sub-basin and river reach characteristics at high spatial resolution. Scientific Data 6: 283.",
        url: "https://doi.org/10.1038/s41597-019-0300-6",
      },
      {
        text: "GIEMS-D15: Fluet-Chouinard, E., Lehner, B., Rebelo, L. M., Papa, F., Hamilton, S. K. (2015). Remote Sensing of Environment, 158, 348–361.",
      },
      {
        text: "GPWv4: CIESIN (2016). Gridded Population of the World, Version 4.",
        url: "https://doi.org/10.7927/H4X63JVC",
      },
      {
        text: "GRanD v1.1: Lehner, B. et al. (2011). Frontiers in Ecology and the Environment 9(9), 494–502.",
      },
    ],
  },
  {
    id: "gires",
    name: "GIRES v1.0 (global prevalence of non-perennial rivers and streams)",
    url: "https://doi.org/10.6084/m9.figshare.14633022",
    license: CC_BY_4,
    citations: [
      {
        text: "Messager, M. L., Lehner, B., Cockburn, C., Lamouroux, N., Pella, H., Snelder, T., Tockner, K., Trautmann, T., Watt, C. & Datry, T. (2021). Global prevalence of non-perennial rivers and streams. Nature.",
        url: "https://doi.org/10.1038/s41586-021-03565-5",
      },
    ],
  },
  {
    id: "hydrolakes",
    name: "HydroLAKES v1.0",
    url: "https://www.hydrosheds.org/products/hydrolakes",
    license: CC_BY_4,
    citations: [
      {
        text: "Messager, M.L., Lehner, B., Grill, G., Nedeva, I., Schmitt, O. (2016): Estimating the volume and age of water stored in global lakes using a geo-statistical approach. Nature Communications: 13603.",
        url: "https://doi.org/10.1038/ncomms13603",
      },
    ],
  },
  {
    id: "ign",
    name: "Instituto Geográfico Nacional de la República Argentina (IGN), capas SIG",
    url: "https://www.ign.gob.ar/NuestrasActividades/InformacionGeoespacial/CapasSIG",
    license: {
      name: "IGN, Términos y Condiciones",
      url: "https://www.ign.gob.ar/descargas/tyc1.html",
    },
    credit: "FUENTE: Instituto Geográfico Nacional de la República Argentina",
    citations: [],
  },
  {
    id: "osm",
    name: "OpenStreetMap",
    url: "https://www.openstreetmap.org/copyright",
    license: {
      name: "Open Database License (ODbL) 1.0",
      url: "https://opendatacommons.org/licenses/odbl/1-0/",
    },
    credit: "© OpenStreetMap contributors",
    citations: [],
  },
  {
    id: "terrain",
    name: "Terrain Tiles (AWS Open Data, Tilezen)",
    url: "https://registry.opendata.aws/terrain-tiles/",
    license: {
      name: "Tilezen joerd attribution terms",
      url: "https://github.com/tilezen/joerd/blob/master/docs/attribution.md",
    },
    credit: BASEMAP_CREDIT,
    citations: [],
  },
  {
    id: "eox",
    name: "EOxCloudless 2024 (Sentinel-2 cloudless)",
    url: "https://cloudless.eox.at",
    license: {
      name: "CC BY-NC-SA 4.0",
      url: "https://creativecommons.org/licenses/by-nc-sa/4.0/",
    },
    credit:
      "EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2024)",
    citations: [],
  },
];

/** Libraries the page credits by name, with the license each package declares. */
export const SOFTWARE = [
  {
    name: "MapLibre GL JS",
    url: "https://maplibre.org",
    license: "BSD-3-Clause",
  },
  {
    name: "PMTiles",
    url: "https://github.com/protomaps/PMTiles",
    license: "BSD-3-Clause",
  },
  { name: "Next.js", url: "https://nextjs.org", license: "MIT" },
  { name: "React", url: "https://react.dev", license: "MIT" },
] as const;
