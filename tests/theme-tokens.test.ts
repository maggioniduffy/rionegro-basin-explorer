import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { THEME_TOKENS, type Theme } from "@/lib/theme-tokens";

const css = readFileSync(join(__dirname, "../app/globals.css"), "utf8");

/** The declarations of the first block that opens with `selector {`. */
function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(start, css.indexOf("\n}", start));
  return Object.fromEntries(
    [...body.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)].map((m) => [m[1], m[2]]),
  );
}

const TOKENS: Record<Theme, Record<string, string>> = {
  dark: block(":root"),
  light: { ...block(":root"), ...block(':root[data-theme="light"]') },
};

type Rgb = [number, number, number];
const hex = (h: string): Rgb => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];
const linear = (c: number) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]: Rgb) =>
  0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
function contrast(a: Rgb, b: Rgb) {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
/** rgba(r, g, b, a) composited over an opaque colour. */
function over(rgba: string, under: Rgb): Rgb {
  const [r = 0, g = 0, b = 0, a = 1] = (rgba.match(/[\d.]+/g) ?? []).map(
    Number,
  );
  const mix = (c: number, u: number) => c * a + u * (1 - a);
  return [mix(r, under[0]), mix(g, under[1]), mix(b, under[2])];
}

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];

describe.each(["dark", "light"] as const)("%s theme", (theme) => {
  const t = (name: string) => {
    const v = TOKENS[theme][name];
    if (v === undefined) throw new Error(`${name} is not defined`);
    return v;
  };

  it("lib/theme-tokens.ts matches globals.css", () => {
    expect(THEME_TOKENS[theme].bg).toBe(t("--bg"));
    expect(THEME_TOKENS[theme].text).toBe(t("--text"));
    expect(THEME_TOKENS[theme].textRgb).toBe(hex(t("--text")).join(", "));
  });

  // WCAG AA (4.5:1) for every text token on the surfaces it is used on. The glass panel
  // sits over satellite imagery, so it is checked over white (snow) and black.
  const surfaces = () => ({
    bg: hex(t("--bg")),
    surface: hex(t("--surface")),
    panelOverWhite: over(t("--panel-glass"), WHITE),
    panelOverBlack: over(t("--panel-glass"), BLACK),
  });
  it.each([
    "--text",
    "--text-secondary",
    "--text-body",
    "--text-strong-muted",
    "--text-footer",
    "--accent",
  ])("%s keeps 4.5:1 on page, cards and panels", (token) => {
    for (const [name, rgb] of Object.entries(surfaces()))
      expect(
        contrast(hex(t(token)), rgb),
        `${token} on ${name}`,
      ).toBeGreaterThanOrEqual(4.5);
  });

  // Tertiary text is for the landing (page and cards) only: on the dark panel over snow
  // it drops to 4.4:1.
  it("--text-tertiary keeps 4.5:1 on page and cards", () => {
    for (const bg of ["--bg", "--surface"])
      expect(
        contrast(hex(t("--text-tertiary")), hex(t(bg))),
      ).toBeGreaterThanOrEqual(4.5);
  });

  it("--on-accent keeps 4.5:1 on --accent (CTA, active locale)", () => {
    expect(
      contrast(hex(t("--on-accent")), hex(t("--accent"))),
    ).toBeGreaterThanOrEqual(4.5);
  });
});
