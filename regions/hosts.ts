import {
  isKnownRegionId,
  knownRegionFromSlug,
  REGION_SLUGS,
  type KnownRegionId,
} from "./index";

/**
 * Domain (owner, 2026-10-12): one host, the region in the path
 * (basinexplorer.vercel.app/cordoba, /rionegro; regions/index.ts REGION_SLUGS). The hosts
 * used before, one per region, now only redirect there (proxy.ts), so links already shared
 * keep working: the production aliases below and, in dev, `<slug or id>.localhost`.
 */
export const PRODUCTION_HUB_HOST = "basinexplorer.vercel.app";
export const REGION_HOSTS: Readonly<Record<KnownRegionId, string>> = {
  nqn: "rionegrobasinexplorer.vercel.app",
  cba: "cordobabasinexplorer.vercel.app",
};

/**
 * Request header proxy.ts sets to the region of a region path, for code that has no route
 * params (i18n/request.ts). Always overwritten by the proxy, so a client can't choose it.
 */
export const REGION_HEADER = "x-basin-region";

/** Request header proxy.ts sets on every other page (the hub, a 404): shared messages only. */
export const HUB_HEADER = "x-basin-hub";

function hostName(host: string | null): string {
  return (host ?? "").toLowerCase().replace(/:\d+$/, "");
}

/**
 * An old per-region host and where it now redirects: a production alias goes to the
 * production hub, `cordoba.localhost:3000` (or `cba.localhost:3000`) to `localhost:3000`.
 * Null for any other host, which serves the hub and the region paths itself.
 */
export function oldRegionHost(
  host: string | null,
): { region: KnownRegionId; hub: string } | null {
  const name = hostName(host);
  const alias = (Object.keys(REGION_HOSTS) as KnownRegionId[]).find(
    (id) => REGION_HOSTS[id] === name,
  );
  if (alias) return { region: alias, hub: PRODUCTION_HUB_HOST };
  const [first, ...rest] = (host ?? "").toLowerCase().split(".");
  if (rest.length === 0 || hostName(rest.join(".")) !== "localhost")
    return null;
  const region = isKnownRegionId(first) ? first : knownRegionFromSlug(first);
  return region ? { region, hub: rest.join(".") } : null;
}

/** The slug of a known region, for redirects from ids and old hosts. */
export const slugOf = (region: KnownRegionId) => REGION_SLUGS[region];
