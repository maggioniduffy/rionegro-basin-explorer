import { describe, expect, it } from "vitest";
import en from "../messages/en.json";
import es from "../messages/es.json";
import { LOCALES } from "../i18n/config";
import { deepMerge, messagesFor, REGION_MESSAGES } from "../i18n/messages";
import { REGION_IDS } from "../regions";

/** Flatten a nested messages object into [dotted.path, value] pairs. */
function leaves(value: unknown, prefix = ""): [string, unknown][] {
  if (typeof value !== "object" || value === null) return [[prefix, value]];
  return Object.entries(value).flatMap(([key, child]) =>
    leaves(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe("messages", () => {
  it("en and es define the same keys", () => {
    const keys = (m: object) =>
      leaves(m)
        .map(([path]) => path)
        .sort();
    expect(keys(es)).toEqual(keys(en));
  });

  it.each([
    ["en", en],
    ["es", es],
  ])("%s has no empty strings", (_, messages) => {
    const empty = leaves(messages)
      .filter(([, v]) => typeof v !== "string" || v.trim() === "")
      .map(([path]) => path);
    expect(empty).toEqual([]);
  });
});

describe("region messages", () => {
  const keys = (m: object) =>
    leaves(m)
      .map(([path]) => path)
      .sort();

  it.each(REGION_IDS.flatMap((r) => LOCALES.map((l) => [r, l] as const)))(
    "%s/%s defines the same keys as nqn/en, none empty",
    (region, locale) => {
      const messages = REGION_MESSAGES[region][locale];
      expect(keys(messages)).toEqual(keys(REGION_MESSAGES.nqn.en));
      expect(
        leaves(messages).filter(
          ([, v]) => typeof v !== "string" || v.trim() === "",
        ),
      ).toEqual([]);
    },
  );

  it("shares no key with /messages, so a merge never hides a shared string", () => {
    const shared = new Set(keys(en));
    expect(keys(REGION_MESSAGES.nqn.en).filter((k) => shared.has(k))).toEqual(
      [],
    );
  });

  it("merges the region's strings over the shared ones", () => {
    const m = messagesFor("nqn", "es");
    expect(m.metadata.title).toBe(REGION_MESSAGES.nqn.es.metadata.title);
    expect(m.home.sources).toBe(es.home.sources);
  });
});

describe("deepMerge", () => {
  it("merges nested objects and leaves its inputs alone", () => {
    const base = { a: { b: 1, c: 2 }, d: 3 };
    expect(deepMerge(base, { a: { c: 9 } })).toEqual({
      a: { b: 1, c: 9 },
      d: 3,
    });
    expect(base.a.c).toBe(2);
  });
});
