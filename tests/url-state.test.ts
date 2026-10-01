import { describe, expect, it } from "vitest";
import {
  parseSelection,
  sameSelection,
  selectionSearch,
} from "@/lib/url-state";

const params = (s: string) => new URLSearchParams(s);

describe("parseSelection", () => {
  it("reads a river or a reach", () => {
    expect(parseSelection(params("r=limay"))).toEqual({
      kind: "river",
      id: "limay",
    });
    expect(parseSelection(params("reach=61523537"))).toEqual({
      kind: "reach",
      id: 61523537,
    });
  });
  it("prefers the river and ignores invalid values", () => {
    expect(parseSelection(params("r=negro&reach=1"))).toEqual({
      kind: "river",
      id: "negro",
    });
    expect(parseSelection(params("r=Bad Id&reach=x"))).toBeNull();
    expect(parseSelection(params(""))).toBeNull();
  });
});

describe("selectionSearch", () => {
  it("round-trips and keeps unrelated parameters", () => {
    const sel = { kind: "reach", id: 42 } as const;
    const qs = selectionSearch(params("foo=1&r=negro"), sel);
    expect(qs).toBe("?foo=1&reach=42");
    expect(parseSelection(params(qs))).toEqual(sel);
  });
  it("clears the selection", () => {
    expect(selectionSearch(params("r=negro"), null)).toBe("");
  });
});

describe("sameSelection", () => {
  it("compares kind and id", () => {
    expect(sameSelection(null, null)).toBe(true);
    expect(
      sameSelection({ kind: "river", id: "a" }, { kind: "river", id: "a" }),
    ).toBe(true);
    expect(sameSelection({ kind: "river", id: "a" }, null)).toBe(false);
  });
});
