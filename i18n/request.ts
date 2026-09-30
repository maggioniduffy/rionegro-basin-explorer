import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";
import { isLocale, LOCALE_COOKIE, negotiateLocale } from "./config";

// Cookie first (set by LocaleSwitcher or the legacy /en, /es redirect in proxy.ts),
// then the browser's Accept-Language, then DEFAULT_LOCALE.
export default getRequestConfig(async () => {
  const saved = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(saved)
    ? saved
    : negotiateLocale((await headers()).get("accept-language"));

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
