/**
 * Theme plumbing shared by the server (app/layout.tsx), the toggle and the map.
 * The CSS tokens live in app/globals.css; MapLibre cannot read CSS variables, so the few
 * colours it needs are repeated here (tests/theme-tokens.test.ts keeps both in sync).
 */
export type Theme = "dark" | "light";

/** Cookie that holds the chosen theme, so the server renders it without a flash. */
export const THEME_COOKIE = "theme";
/** One year, in seconds. */
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const isTheme = (v: unknown): v is Theme =>
  v === "dark" || v === "light";

export function saveTheme(theme: Theme) {
  document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=${THEME_COOKIE_MAX_AGE}; samesite=lax`;
}

/** `--bg` and `--text` per theme, with `--text` as an "r, g, b" triple for rgba(). */
export const THEME_TOKENS: Record<
  Theme,
  { bg: string; text: string; textRgb: string }
> = {
  dark: { bg: "#0b1320", text: "#eef0e8", textRgb: "238, 240, 232" },
  light: { bg: "#f5f7f4", text: "#13233d", textRgb: "19, 35, 61" },
};
