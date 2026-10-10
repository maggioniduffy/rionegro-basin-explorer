import { DEFAULT_REGION, isKnownRegionId, type KnownRegionId } from "./index";

/**
 * Hosts whose name doesn't start with a region id (e.g. a `*.vercel.app` alias per region,
 * decided later: DECISSIONS.md, Multi-region). Lowercase, without port.
 */
const HOST_REGIONS: Readonly<Record<string, KnownRegionId>> = {};

/**
 * The region a host asks for: the table above, else a first label that is a known region id
 * (`cba.example.com`, `cba.localhost:3000`), else the default region, so today's
 * rionegrobasinexplorer.vercel.app and plain localhost keep serving the Río Negro basin.
 * A known region that isn't served yet (regions/index.ts REGION_IDS) is returned as is;
 * proxy.ts answers 404 for it rather than showing another region.
 */
export function regionFromHost(host: string | null): KnownRegionId {
  const name = (host ?? "").toLowerCase().replace(/:\d+$/, "");
  const mapped = HOST_REGIONS[name];
  if (mapped) return mapped;
  const label = name.split(".")[0];
  return isKnownRegionId(label) ? label : DEFAULT_REGION;
}

/**
 * Request header proxy.ts sets to the region it routes to, for code that has no route
 * params (i18n/request.ts). Always overwritten by the proxy, so a client can't choose it.
 */
export const REGION_HEADER = "x-basin-region";
