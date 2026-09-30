import { NextResponse, type NextRequest } from "next/server";
import { isLocale, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE } from "./i18n/config";

/**
 * URLs no longer carry the locale (it lives in a cookie; see i18n/config.ts).
 * Links shared before that change, like /es?r=limay, still work: the prefix becomes
 * the locale cookie and the browser is redirected to the same path without it.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const [, prefix, ...rest] = pathname.split("/");
  // The matcher already limits this to /en and /es paths; guard anyway.
  if (!isLocale(prefix)) return NextResponse.next();
  const url = new URL(`/${rest.join("/")}${search}`, request.url);
  const response = NextResponse.redirect(url, 308);
  response.cookies.set(LOCALE_COOKIE, prefix, {
    path: "/",
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: "lax",
  });
  return response;
}

// Must be a static literal (Next parses it at build time); keep in sync with LOCALES.
export const config = {
  matcher: ["/en", "/en/:path*", "/es", "/es/:path*"],
};
