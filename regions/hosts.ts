import { DEFAULT_REGION, isRegionId, type RegionId } from "./index";

/**
 * Hosts whose name doesn't start with a region id (e.g. a `*.vercel.app` alias per region,
 * decided later: DECISSIONS.md, Multi-region). Lowercase, without port.
 */
const HOST_REGIONS: Readonly<Record<string, RegionId>> = {};

/**
 * The region a host serves: the table above, else a first label that is a region id
 * (`cba.example.com`, `cba.localhost:3000`), else the default region, so today's
 * rionegrobasinexplorer.vercel.app and plain localhost keep serving the Río Negro basin.
 */
export function regionFromHost(host: string | null): RegionId {
  const name = (host ?? "").toLowerCase().replace(/:\d+$/, "");
  const mapped = HOST_REGIONS[name];
  if (mapped) return mapped;
  const label = name.split(".")[0];
  return isRegionId(label) ? label : DEFAULT_REGION;
}

/**
 * Request header proxy.ts sets to the region it routes to, for code that has no route
 * params (i18n/request.ts). Always overwritten by the proxy, so a client can't choose it.
 */
export const REGION_HEADER = "x-basin-region";
