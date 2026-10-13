import { DEFAULT_REGION, isKnownRegionId, type KnownRegionId } from "./index";

/**
 * Domain (owner, 2026-10-12): the hub at basinexplorer.vercel.app, each region one label
 * above it (rionegro.basinexplorer.vercel.app, cordoba.basinexplorer.vercel.app). Whether
 * Vercel issues nested *.vercel.app names for this project is not verified (community
 * reports: only under the team slug); if it doesn't, the fallback hosts go in HOST_REGIONS
 * and REGION_URLS, with no code change.
 */

/** The first host label of each region (the region id works too: `cba.localhost:3000`). */
export const REGION_HOST_LABELS: Readonly<Record<KnownRegionId, string>> = {
  nqn: "rionegro",
  cba: "cordoba",
};

/**
 * Hosts whose first label is neither a region label nor a region id (e.g. a single-label
 * `*.vercel.app` alias per region). Lowercase, without port.
 */
const HOST_REGIONS: Readonly<Record<string, KnownRegionId>> = {};

const regionOfLabel = (label: string | undefined): KnownRegionId | null => {
  if (isKnownRegionId(label)) return label;
  const hit = Object.entries(REGION_HOST_LABELS).find(([, l]) => l === label);
  return hit ? (hit[0] as KnownRegionId) : null;
};

/**
 * The region a host asks for: the table above, else a first label that is a region label or
 * id (`cordoba.basinexplorer.vercel.app`, `cba.localhost:3000`), else the default region, so
 * today's rionegrobasinexplorer.vercel.app and plain localhost keep serving the Río Negro
 * basin. A known region that isn't served yet (regions/index.ts REGION_IDS) is returned as
 * is; proxy.ts answers 404 for it rather than showing another region. Hub hosts are checked
 * first, in proxy.ts (isHubHost).
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
 * The hub (R4): a page listing the served regions, outside every region. Served on the hosts
 * in HUB_HOSTS (code) and the HUB_HOSTS env (comma-separated, lowercase, no port), and on any
 * host whose first label is HUB_LABEL (`hub.localhost:3000` in dev). No other host changes.
 */
export const HUB_LABEL = "hub";
const HUB_HOSTS = ["basinexplorer.vercel.app"];

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
  if (name === "") return false;
  return (
    name.split(".")[0] === HUB_LABEL ||
    HUB_HOSTS.includes(name) ||
    list(env.HUB_HOSTS).includes(name)
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
 * when set; else, on a `hub.` host, that label swapped for the region's (`hub.localhost:3000`
 * -> `cordoba.localhost:3000`); else the region's label above the hub host
 * (`cordoba.basinexplorer.vercel.app`).
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
  const label = REGION_HOST_LABELS[region];
  const [first, ...rest] = host.split(".");
  return first === HUB_LABEL
    ? `${protocol}://${[label, ...rest].join(".")}`
    : `${protocol}://${label}.${host}`;
}

/**
 * The hub's origin, seen from a region host: HUB_URL when set; else, when the host's first
 * label is a region label or id, the host without it if that is a hub host
 * (`cordoba.basinexplorer.vercel.app` -> `basinexplorer.vercel.app`), or with it swapped for
 * `hub` (`cba.localhost:3000` -> `hub.localhost:3000`, dev). Null for any other host (today's
 * rionegrobasinexplorer.vercel.app, plain localhost): no hub there, so no link to one.
 */
export function hubOrigin(
  host: string | null,
  protocol: string,
  env: Env = process.env,
): string | null {
  const configured = env.HUB_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const h = (host ?? "").toLowerCase();
  const [first, ...rest] = h.split(".");
  if (rest.length === 0 || regionOfLabel(first) === null) return null;
  const above = rest.join(".");
  if (isHubHost(above, env)) return `${protocol}://${above}`;
  const swapped = [HUB_LABEL, ...rest].join(".");
  return isHubHost(swapped, env) ? `${protocol}://${swapped}` : null;
}
