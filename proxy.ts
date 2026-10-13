import { NextResponse, type NextRequest } from "next/server";
import { isLocale, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE } from "./i18n/config";
import { legacyMapPath } from "./lib/url-state";
import { isKnownRegionId, regionFromSlug } from "./regions";
import {
  HUB_HEADER,
  oldRegionHost,
  REGION_HEADER,
  slugOf,
} from "./regions/hosts";

/**
 * Regions live in the path (owner, 2026-10-12): /cordoba, /rionegro (regions/index.ts
 * REGION_SLUGS), the app/[region] route param itself, so nothing is rewritten for them.
 *
 * 1. URLs carry no locale (it lives in a cookie; see i18n/config.ts). /en and /es, the
 *    landing's language links and links shared before the cookie, set the cookie and
 *    redirect (307, no-store) to the same path without the prefix.
 * 2. The old per-region hosts (regions/hosts.ts oldRegionHost) redirect to the hub host with
 *    the region's path, so links shared before keep working.
 * 3. `/` is the hub (app/hub), on every host.
 * 4. A region path gets REGION_HEADER; links from before the map moved to /map
 *    (/rionegro?r=limay) land on the map.
 * 5. A path starting with a region id (/nqn/map) redirects to the slug.
 * 6. Anything else gets HUB_HEADER: the 404 page uses the shared messages, never a region's.
 */
export function proxy(request: NextRequest) {
  const { pathname, search, searchParams } = request.nextUrl;
  const [, prefix = "", ...rest] = pathname.split("/");
  const redirect = (url: string | URL) => NextResponse.redirect(url, 308);

  if (isLocale(prefix)) {
    // Temporary and uncacheable: the redirect exists to set the cookie. A cached 308 would
    // send the browser /en -> / on its own and the cookie would never be set again.
    const response = NextResponse.redirect(
      new URL(`/${rest.join("/")}${search}`, request.url),
      307,
    );
    response.headers.set("Cache-Control", "no-store");
    response.cookies.set(LOCALE_COOKIE, prefix, {
      path: "/",
      maxAge: LOCALE_COOKIE_MAX_AGE,
      sameSite: "lax",
    });
    return response;
  }

  const old = oldRegionHost(request.headers.get("host"));
  // In dev, Next makes a redirect to the dev server's own origin (localhost) relative, so
  // cordoba.localhost/map lands on cordoba.localhost/cordoba/map: a region path is then
  // served as is instead of redirecting again. On Vercel the hosts differ and it redirects.
  if (old && !regionFromSlug(prefix)) {
    const inner = legacyMapPath(pathname, searchParams) ?? pathname;
    const path = `/${slugOf(old.region)}${inner === "/" ? "" : inner}`;
    return redirect(`${request.nextUrl.protocol}//${old.hub}${path}${search}`);
  }

  const headers = new Headers(request.headers);
  // Only the proxy sets these.
  headers.delete(HUB_HEADER);
  headers.delete(REGION_HEADER);

  const region = regionFromSlug(prefix);
  if (region) {
    const inner = `/${rest.join("/")}`;
    const legacy = legacyMapPath(inner, searchParams);
    if (legacy)
      return redirect(new URL(`/${prefix}${legacy}${search}`, request.url));
    headers.set(REGION_HEADER, region);
    return NextResponse.next({ request: { headers } });
  }

  if (isKnownRegionId(prefix)) {
    const url = request.nextUrl.clone();
    url.pathname = `/${[slugOf(prefix), ...rest].join("/")}`;
    return redirect(url);
  }

  headers.set(HUB_HEADER, "1");
  if (pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/hub";
    return NextResponse.rewrite(url, { request: { headers } });
  }
  return NextResponse.next({ request: { headers } });
}

// Must be a static literal (Next parses it at build time). Everything but build output and
// files: /public (tiles, landing image, MapLibre worker) and app/ icons, which have a dot.
export const config = {
  matcher: ["/((?!_next/|tiles/|landing/|maplibre/|.*\\.[^/]+$).*)"],
};
