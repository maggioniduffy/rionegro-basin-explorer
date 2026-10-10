import { NextResponse, type NextRequest } from "next/server";
import { isLocale, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE } from "./i18n/config";
import { legacyMapPath } from "./lib/url-state";
import { isRegionId } from "./regions";
import { regionFromHost } from "./regions/hosts";

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
 */
export function proxy(request: NextRequest) {
  const { pathname, search, searchParams } = request.nextUrl;
  const [, prefix, ...rest] = pathname.split("/");
  const locale = isLocale(prefix) ? prefix : null;
  const path = locale ? `/${rest.join("/")}` : pathname;
  const target = legacyMapPath(path, searchParams) ?? path;
  if (!locale && target === pathname) {
    if (isRegionId(prefix)) return NextResponse.next();
    const url = request.nextUrl.clone();
    const region = regionFromHost(request.headers.get("host"));
    url.pathname = pathname === "/" ? `/${region}` : `/${region}${pathname}`;
    return NextResponse.rewrite(url);
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
