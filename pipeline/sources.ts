/**
 * Remote inputs for the pipeline. Licenses and citations: SOURCES.md.
 * URLs were checked on 2026-09-29 (HEAD / 1-byte range request).
 */
export interface Source {
  id: string;
  url: string;
  /** Archive file name as served. */
  file: string;
  /** Approximate size, only for the log before a download starts. */
  approxBytes: number;
}

export const SOURCES: Source[] = [
  {
    id: "hydrorivers",
    url: "https://data.hydrosheds.org/file/HydroRIVERS/HydroRIVERS_v10_sa_shp.zip",
    file: "HydroRIVERS_v10_sa_shp.zip",
    approxBytes: 95_257_204,
  },
  {
    id: "hydrobasins",
    url: "https://data.hydrosheds.org/file/hydrobasins/standard/hybas_sa_lev01-12_v1c.zip",
    file: "hybas_sa_lev01-12_v1c.zip",
    approxBytes: 334_160_720,
  },
  {
    // Global only; linked from https://www.hydrosheds.org/products/hydroatlas.
    // figshare.com/ndownloader blocks non-browser clients; this host redirects to S3.
    id: "riveratlas",
    url: "https://ndownloader.figshare.com/files/20087321",
    file: "RiverATLAS_Data_v10.gdb.zip",
    approxBytes: 2_506_480_742,
  },
];
