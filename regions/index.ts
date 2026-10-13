/**
 * Region registry (PLAN.md, Multi-region). Each region is a folder regions/<id>/; the app and
 * the pipeline pick one by id. `nqn` is the Río Negro basin (Limay, Neuquén, Negro); `cba`
 * is Córdoba (province and nearby interprovincial basins).
 */

/** Every region the pipeline and the data scripts accept (--region), served or not. */
export const KNOWN_REGION_IDS = ["nqn", "cba"] as const;

export type KnownRegionId = (typeof KNOWN_REGION_IDS)[number];

export function isKnownRegionId(value: unknown): value is KnownRegionId {
  return (KNOWN_REGION_IDS as readonly unknown[]).includes(value);
}

/**
 * Regions the app serves. A region joins this list only once its app content exists:
 * adding its id makes TypeScript name every per-region record still missing it (map
 * config, messages, content, landing sample, OG shapes, landing image). See
 * regions/cba/README.md for the checklist.
 */
export const REGION_IDS = [
  "nqn",
  "cba",
] as const satisfies readonly KnownRegionId[];

export type RegionId = (typeof REGION_IDS)[number];

/**
 * The fallback for code that needs some region and has none to read (React context default,
 * shared map constants, the OG alt). Never a URL's region: an unknown path is a 404.
 */
export const DEFAULT_REGION: RegionId = "nqn";

export function isRegionId(value: unknown): value is RegionId {
  return (REGION_IDS as readonly unknown[]).includes(value);
}

/**
 * The region's first path segment (owner, 2026-10-12): basinexplorer.vercel.app/cordoba,
 * /rionegro. It is the app/[region] route param; ids stay internal (pipeline, data, tiles).
 */
export const REGION_SLUGS: Readonly<Record<KnownRegionId, string>> = {
  nqn: "rionegro",
  cba: "cordoba",
};

/** The served region a path segment names, else null (no fallback to another region). */
export function regionFromSlug(raw: unknown): RegionId | null {
  const hit = REGION_IDS.find((id) => REGION_SLUGS[id] === raw);
  return hit ?? null;
}

/** The known region (served or not) a slug names, else null. */
export function knownRegionFromSlug(raw: unknown): KnownRegionId | null {
  return KNOWN_REGION_IDS.find((id) => REGION_SLUGS[id] === raw) ?? null;
}

/** A path inside the region: regionPath("cba") = "/cordoba", regionPath("cba", "/map"). */
export function regionPath(region: RegionId, path = "/"): string {
  const base = `/${REGION_SLUGS[region]}`;
  return path === "/" ? base : `${base}${path}`;
}

/**
 * Each region has its own Mongo database on the same cluster, named after MONGODB_DB (the
 * base name). `nqn` keeps the base name itself, the database seeded before regions existed;
 * every other region appends `-<id>` (e.g. basin-explorer-cba).
 */
const DB_SUFFIX: Record<KnownRegionId, string> = { nqn: "", cba: "-cba" };

export function regionDbName(base: string, region: KnownRegionId): string {
  return `${base}${DB_SUFFIX[region]}`;
}
