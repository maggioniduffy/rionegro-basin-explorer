import { DEFAULT_REGION, isKnownRegionId, type KnownRegionId } from "./index";

/**
 * Domain (owner, 2026-10-12): the hub at basinexplorer.vercel.app and one single-label
 * *.vercel.app alias per region below. Vercel refused nested names
 * (cordoba.basinexplorer.vercel.app), so regions are not subdomains of the hub.
 */
export const PRODUCTION_HUB_HOST = "basinexplorer.vercel.app";
export const REGION_HOSTS: Readonly<Record<KnownRegionId, string>> = {
  nqn: "rionegrobasinexplorer.vercel.app",
  cba: "cordobabasinexplorer.vercel.app",
};

/** The first host label of each region in dev (`cordoba.localhost:3000`; the id works too). */
export const REGION_HOST_LABELS: Readonly<Record<KnownRegionId, string>> = {
  nqn: "rionegro",
  cba: "cordoba",
};

/** Host -> region, from REGION_HOSTS. Lowercase, without port. */
const HOST_REGIONS: Readonly<Record<string, KnownRegionId>> =
  Object.fromEntries(
    Object.entries(REGION_HOSTS).map(([id, host]) => [
      host,
      id as KnownRegionId,
    ]),
  );

const regionOfLabel = (label: string | undefined): KnownRegionId | null => {
  if (isKnownRegionId(label)) return label;
  const hit = Object.entries(REGION_HOST_LABELS).find(([, l]) => l === label);
  return hit ? (hit[0] as KnownRegionId) : null;
};

/**
 * The region a host asks for: REGION_HOSTS, else a first label that is a region label or id
 * (`cordoba.localhost:3000`, `cba.localhost:3000`), else the default region, so an unknown
 * host (e.g. a deployment URL) keeps serving the Río Negro basin. Hub hosts, plain localhost
 * included, are checked first, in proxy.ts (isHubHost). A known region that isn't served
 * yet (regions/index.ts REGION_IDS) is returned as is; proxy.ts answers 404 for it rather
 * than showing another region.
 */
export function regionFromHost(host: string | null): KnownRegionId {
  const name = hostName(host);
  const mapped = HOST_REGIONS[name];
  if (mapped) return mapped;
  return regionOfLabel(name.split(".")[0]) ?? DEFAULT_REGION;
}

/**
 * Request header proxy.ts sets to the region it routes to, for code that has no route
 * params (i18n/request.ts). Always overwritten by the proxy, so a client can't choose it.
 */
export const REGION_HEADER = "x-basin-region";

/**
 * The hub (R4): the app's entry point, a page listing the served regions, outside every
 * region (owner, 2026-10-12). Served on plain localhost (dev), the production hub and the
 * HUB_HOSTS env (comma-separated, lowercase, no port). Regions are one label above it in
 * dev (`cordoba.localhost:3000`) and on their own alias in production (REGION_HOSTS).
 */
const HUB_HOSTS = [PRODUCTION_HUB_HOST, "localhost"];

/** Request header proxy.ts sets on hub requests (and strips from every other request). */
export const HUB_HEADER = "x-basin-hub";

type Env = Record<string, string | undefined>;

function hostName(host: string | null): string {
  return (host ?? "").toLowerCase().replace(/:\d+$/, "");
}

const list = (v: string | undefined) =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

export function isHubHost(
  host: string | null,
  env: Env = process.env,
): boolean {
  const name = hostName(host);
  return (
    name !== "" &&
    (HUB_HOSTS.includes(name) || list(env.HUB_HOSTS).includes(name))
  );
}

/** http for localhost (dev), else the forwarded protocol, else https. */
export function protocolOf(
  host: string | null,
  forwarded: string | null,
): string {
  if (forwarded) return forwarded.split(",")[0]!.trim();
  const name = hostName(host);
  return name === "localhost" || name.endsWith(".localhost") ? "http" : "https";
}

/**
 * The public origin of a region, seen from the hub: REGION_URLS ("nqn=https://…,cba=https://…")
 * when set; else the region's production alias from the production hub (REGION_HOSTS); else
 * (dev) the region's label above the hub host (`localhost:3000` -> `cordoba.localhost:3000`).
 */
export function regionOrigin(
  region: KnownRegionId,
  hubHost: string | null,
  protocol: string,
  env: Env = process.env,
): string | null {
  for (const entry of (env.REGION_URLS ?? "").split(",")) {
    const [id, url] = entry.split("=").map((s) => s.trim());
    if (id === region && url) return url.replace(/\/$/, "");
  }
  const host = (hubHost ?? "").toLowerCase();
  if (host === "") return null;
  return hostName(host) === PRODUCTION_HUB_HOST
    ? `${protocol}://${REGION_HOSTS[region]}`
    : `${protocol}://${REGION_HOST_LABELS[region]}.${host}`;
}

/**
 * The hub's origin, seen from a region host: HUB_URL when set; else the production hub for a
 * production alias (REGION_HOSTS); else, in dev, the host without its region label or id when
 * that is a hub host (`cordoba.localhost:3000` -> `localhost:3000`). Null for any other host:
 * no hub there, so no link to one.
 */
export function hubOrigin(
  host: string | null,
  protocol: string,
  env: Env = process.env,
): string | null {
  const configured = env.HUB_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const name = hostName(host);
  if (HOST_REGIONS[name]) return `${protocol}://${PRODUCTION_HUB_HOST}`;
  const [first, ...rest] = (host ?? "").toLowerCase().split(".");
  const above = rest.join(".");
  return rest.length > 0 &&
    regionOfLabel(first) !== null &&
    isHubHost(above, env)
    ? `${protocol}://${above}`
    : null;
}
