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
  /** Publisher's MD5 (figshare publishes one), verified after download. */
  md5?: string;
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
  {
    // GIRES v1.0, non-perennial river predictions per HydroRIVERS reach (Messager et
    // al. 2021). https://doi.org/10.6084/m9.figshare.14633022; size and MD5 from the
    // figshare API (articles/14633022), checked 2026-09-30.
    id: "gires",
    url: "https://ndownloader.figshare.com/files/28280484",
    file: "GIRES_v10_gdb.zip",
    approxBytes: 1_699_860_028,
    md5: "75d41f596ee84cb7b78ed55b5b85e878",
  },
];
