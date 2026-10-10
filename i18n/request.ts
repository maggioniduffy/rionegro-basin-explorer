import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";
import { DEFAULT_REGION, isRegionId } from "@/regions";
import { REGION_HEADER } from "@/regions/hosts";
import { isLocale, LOCALE_COOKIE, negotiateLocale } from "./config";
import { messagesFor } from "./messages";

// Cookie first (set by LocaleSwitcher or the legacy /en, /es redirect in proxy.ts),
// then the browser's Accept-Language, then DEFAULT_LOCALE. The region comes from the
// header proxy.ts sets on every page and API request.
export default getRequestConfig(async () => {
  const h = await headers();
  const saved = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(saved)
    ? saved
    : negotiateLocale(h.get("accept-language"));
  const header = h.get(REGION_HEADER);
  const region = isRegionId(header) ? header : DEFAULT_REGION;

  return { locale, messages: messagesFor(region, locale) };
});
