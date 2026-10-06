import { NextResponse, type NextRequest } from "next/server";
import { isLocale, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE } from "./i18n/config";
import { legacyMapPath } from "./lib/url-state";

/**
 * URLs carry no locale (it lives in a cookie; see i18n/config.ts). /en and /es, the
 * landing's language links and links shared before the cookie, set the cookie and
 * redirect to the same path without the prefix. Links from before the map moved to
 * /map (/?r=limay, /es?s=neuquen) land on the map.
 */
export function proxy(request: NextRequest) {
  const { pathname, search, searchParams } = request.nextUrl;
  const [, prefix, ...rest] = pathname.split("/");
  const locale = isLocale(prefix) ? prefix : null;
  const path = locale ? `/${rest.join("/")}` : pathname;
  const target = legacyMapPath(path, searchParams) ?? path;
  if (!locale && target === pathname) return NextResponse.next();

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

// Must be a static literal (Next parses it at build time); keep in sync with LOCALES.
export const config = {
  matcher: ["/", "/en", "/en/:path*", "/es", "/es/:path*"],
};
