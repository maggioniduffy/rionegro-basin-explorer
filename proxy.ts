import { NextResponse, type NextRequest } from "next/server";
import { isLocale, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE } from "./i18n/config";
import { legacyMapPath } from "./lib/url-state";
import { isRegionId } from "./regions";
import {
  HUB_HEADER,
  isHubHost,
  REGION_HEADER,
  regionFromHost,
} from "./regions/hosts";

/**
 * URLs carry no locale (it lives in a cookie; see i18n/config.ts). /en and /es, the
 * landing's language links and links shared before the cookie, set the cookie and
 * redirect to the same path without the prefix. Links from before the map moved to
 * /map (/?r=limay, /es?s=neuquen) land on the map.
 *
 * Every other request is rewritten to its host's region (regions/hosts.ts): pages and API
 * routes live under app/[region], and the region never shows in the URL. A path that
 * already starts with a region id is served as is (metadata routes such as
 * /nqn/opengraph-image are linked that way).
 *
 * A hub host (regions/hosts.ts isHubHost) serves the hub: `/` is rewritten to app/hub with
 * HUB_HEADER and no region; other paths are 404 except region-prefixed ones (above).
 */
export function proxy(request: NextRequest) {
  const { pathname, search, searchParams } = request.nextUrl;
  const [, prefix, ...rest] = pathname.split("/");
  const locale = isLocale(prefix) ? prefix : null;
  const path = locale ? `/${rest.join("/")}` : pathname;
  const target = legacyMapPath(path, searchParams) ?? path;
  if (!locale && target === pathname) {
    const headers = new Headers(request.headers);
    // Only the proxy decides whether a request is the hub's.
    headers.delete(HUB_HEADER);
    // Region-prefixed paths pass on every host, the hub's included: metadata URLs (OG images)
    // are made absolute with the production domain, which may be the hub's.
    if (isRegionId(prefix)) {
      headers.set(REGION_HEADER, prefix);
      return NextResponse.next({ request: { headers } });
    }
    if (isHubHost(request.headers.get("host"))) {
      if (pathname !== "/") return new NextResponse(null, { status: 404 });
      const url = request.nextUrl.clone();
      url.pathname = "/hub";
      headers.delete(REGION_HEADER);
      headers.set(HUB_HEADER, "1");
      return NextResponse.rewrite(url, { request: { headers } });
    }
    const region = regionFromHost(request.headers.get("host"));
    // A region that exists in the pipeline but has no app content yet (e.g. cba).
    if (!isRegionId(region)) return new NextResponse(null, { status: 404 });
    const url = request.nextUrl.clone();
    url.pathname = pathname === "/" ? `/${region}` : `/${region}${pathname}`;
    headers.set(REGION_HEADER, region);
    return NextResponse.rewrite(url, { request: { headers } });
  }

  const response = NextResponse.redirect(
    new URL(`${target}${search}`, request.url),
    308,
  );
  if (locale)
    response.cookies.set(LOCALE_COOKIE, locale, {
      path: "/",
      maxAge: LOCALE_COOKIE_MAX_AGE,
      sameSite: "lax",
    });
  return response;
}

// Must be a static literal (Next parses it at build time). Everything but build output and
// files: /public (tiles, landing image, MapLibre worker) and app/ icons, which have a dot.
export const config = {
  matcher: ["/((?!_next/|tiles/|landing/|maplibre/|.*\\.[^/]+$).*)"],
};
