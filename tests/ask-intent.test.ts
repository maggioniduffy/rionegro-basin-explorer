import { describe, expect, it } from "vitest";
import {
  INTENT_JSON_SCHEMA,
  intentSchema,
  validateIntent,
  validateIntentText,
} from "@/lib/ask/intent";
import { askCacheKey, ASK_MAX_LENGTH, parseAsk } from "@/lib/ask/query";

const known = {
  rivers: new Set(["limay", "collon-cura"]),
  subbasins: new Set(["limay", "endorheic"]),
};
const unsupported = { action: "unsupported" };

describe("validateIntent", () => {
  it("accepts known ids of the right kind, with the provider's null fields", () => {
    expect(
      validateIntent(
        { action: "select_river", slug: "collon-cura", query: null },
        known,
      ),
    ).toEqual({ action: "select_river", slug: "collon-cura" });
    expect(
      validateIntent(
        { action: "select_subbasin", slug: "endorheic", query: null },
        known,
      ),
    ).toEqual({ action: "select_subbasin", slug: "endorheic" });
    expect(
      validateIntent(
        { action: "search", slug: null, query: "Arroyo Comallo" },
        known,
      ),
    ).toEqual({ action: "search", query: "Arroyo Comallo" });
  });

  it("turns an invented slug into unsupported", () => {
    expect(
      validateIntent({ action: "select_river", slug: "amazonas" }, known),
    ).toEqual(unsupported);
  });

  it("turns a slug of the wrong kind into unsupported", () => {
    expect(
      validateIntent({ action: "select_subbasin", slug: "collon-cura" }, known),
    ).toEqual(unsupported);
    expect(
      validateIntent({ action: "select_river", slug: "endorheic" }, known),
    ).toEqual(unsupported);
  });

  it.each([
    ["extra keys", { action: "select_river", slug: "limay", answer: "42 km" }],
    ["unknown action", { action: "answer", slug: "limay" }],
    ["missing slug", { action: "select_river" }],
    ["slug not a slug", { action: "select_river", slug: "Río Limay" }],
    ["wrong type", { action: "search", query: 42 }],
    ["empty query", { action: "search", query: "  " }],
    ["array", [{ action: "unsupported" }]],
    ["null", null],
    ["string", "select_river"],
  ])("%s → unsupported", (_, raw) => {
    expect(validateIntent(raw, known)).toEqual(unsupported);
  });

  it("parses text and rejects invalid JSON", () => {
    expect(
      validateIntentText('{"action":"select_river","slug":"limay"}', known),
    ).toEqual({ action: "select_river", slug: "limay" });
    expect(validateIntentText("Sure! The Limay is 500 km", known)).toEqual(
      unsupported,
    );
  });
});

describe("INTENT_JSON_SCHEMA", () => {
  it("lists the same actions as the Zod schema", () => {
    const actions = intentSchema.options.map((o) => o.shape.action.value);
    expect([...INTENT_JSON_SCHEMA.properties.action.enum].sort()).toEqual(
      actions.sort(),
    );
  });

  it("is strict-mode ready: every property required, no extras", () => {
    expect([...INTENT_JSON_SCHEMA.required].sort()).toEqual(
      Object.keys(INTENT_JSON_SCHEMA.properties).sort(),
    );
    expect(INTENT_JSON_SCHEMA.additionalProperties).toBe(false);
  });
});

describe("parseAsk", () => {
  it("normalizes accents, case, punctuation and spacing", () => {
    expect(parseAsk("  ¿Río   COLLÓN Curá? ")).toMatchObject({
      normalized: "rio collon cura",
      name: "rio collon cura",
      wantsSubbasin: false,
    });
  });

  it("reduces a request to the name and detects a basin", () => {
    expect(parseAsk("Mostrame la subcuenca del Neuquén")).toEqual({
      normalized: "mostrame la subcuenca del neuquen",
      name: "neuquen",
      wantsSubbasin: true,
    });
    expect(parseAsk("show me the Limay basin")).toMatchObject({
      name: "limay",
      wantsSubbasin: true,
    });
  });

  it("rejects empty and too long questions", () => {
    expect(parseAsk(" ?! ")).toBeNull();
    expect(parseAsk("a".repeat(ASK_MAX_LENGTH + 1))).toBeNull();
  });
});

describe("askCacheKey", () => {
  it("is the same for variants that normalize the same", () => {
    const a = parseAsk("Collón Curá")!.normalized;
    const b = parseAsk("collon  cura")!.normalized;
    expect(askCacheKey(a, "en", "v")).toBe(askCacheKey(b, "en", "v"));
  });

  it("changes with the locale and the catalog version, and hides the text", () => {
    const key = askCacheKey("limay", "en", "v1");
    expect(askCacheKey("limay", "es", "v1")).not.toBe(key);
    expect(askCacheKey("limay", "en", "v2")).not.toBe(key);
    expect(key).not.toContain("limay");
  });
});
