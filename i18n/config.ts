/**
 * Locales without URL prefixes: the locale lives in a cookie, so switching language
 * refreshes server components in place instead of navigating (the map survives).
 */
export const LOCALES = ["en", "es"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "es";
export const LOCALE_COOKIE = "NEXT_LOCALE";
/** One year, in seconds. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const isLocale = (v: unknown): v is Locale =>
  typeof v === "string" && (LOCALES as readonly string[]).includes(v);

/**
 * Best supported locale from an Accept-Language header, by q-value then order;
 * matches on the primary subtag (es-AR → es). Falls back to DEFAULT_LOCALE.
 */
export function negotiateLocale(header: string | null | undefined): Locale {
  if (!header) return DEFAULT_LOCALE;
  const ranked = header
    .split(",")
    .map((part, i) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      return {
        lang: tag.toLowerCase().split("-")[0],
        q: q ? Number(q.slice(2)) : 1,
        i,
      };
    })
    .filter((x) => x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  return ranked.map((x) => x.lang).find(isLocale) ?? DEFAULT_LOCALE;
}
