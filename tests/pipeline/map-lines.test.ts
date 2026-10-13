import { describe, expect, it } from "vitest";
import { resolveMapLines } from "../../pipeline/lib/map-lines";
import { pieceOrder, pieceOrderSql } from "../../pipeline/lib/map-config";

describe("resolveMapLines", () => {
  it("defaults to the reaches (nqn) and accepts pieces", () => {
    expect(resolveMapLines(undefined)).toBe("reaches");
    expect(resolveMapLines("reaches")).toBe("reaches");
    expect(resolveMapLines("pieces")).toBe("pieces");
  });

  it("throws on any other value, naming the region", () => {
    expect(() => resolveMapLines("lines", "cba")).toThrow(/regions\/cba/);
    expect(() => resolveMapLines(null, "cba")).toThrow(/mapLines/);
  });
});

describe("pieceOrder", () => {
  const config = { pieceOrderByClass: { "aprhi:Río": 3, "*": 1 } };

  it("uses the matched reach's Strahler order", () => {
    expect(
      pieceOrder(config, { strahler: 5, src: "aprhi", cls: "Arroyo" }),
    ).toBe(5);
  });

  it("falls back to the class table, then to '*', for a piece no reach matched", () => {
    expect(pieceOrder(config, { src: "aprhi", cls: "Río" })).toBe(3);
    expect(
      pieceOrder(config, { strahler: null, src: "ign", cls: "perennial" }),
    ).toBe(1);
  });

  it("throws when the table is missing", () => {
    expect(() => pieceOrder({}, { src: "aprhi", cls: "Río" })).toThrow(
      /pieceOrderByClass/,
    );
  });
});

describe("pieceOrderSql", () => {
  it("is the same rule as pieceOrder, as SQL over strahler, src and cls", () => {
    expect(
      pieceOrderSql({
        pieceOrderByClass: { "aprhi:Río": 3, "ign:perennial": 3, "*": 1 },
      }),
    ).toBe(
      "coalesce(strahler, CASE src || ':' || cls WHEN 'aprhi:Río' THEN 3 WHEN 'ign:perennial' THEN 3 ELSE 1 END)",
    );
  });
});
