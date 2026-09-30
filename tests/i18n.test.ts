import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, isLocale, negotiateLocale } from "../i18n/config";

describe("negotiateLocale", () => {
  it.each([
    ["es-AR,es;q=0.9,en;q=0.8", "es"],
    ["en-US,en;q=0.9", "en"],
    ["de-DE,de;q=0.9", DEFAULT_LOCALE], // unsupported → default
    ["de-DE,en;q=0.5", "en"],
    ["fr;q=1, es;q=0.2, en;q=0.7", "en"], // q-value beats order
    ["en;q=0, es", "es"], // q=0 means "not acceptable"
    ["", DEFAULT_LOCALE],
    [null, DEFAULT_LOCALE],
  ])("%s → %s", (header, expected) => {
    expect(negotiateLocale(header)).toBe(expected);
  });
});

describe("isLocale", () => {
  it("accepts only supported locales", () => {
    expect(isLocale("en")).toBe(true);
    expect(isLocale("es")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });
});
