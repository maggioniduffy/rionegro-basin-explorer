import { describe, expect, it } from "vitest";
import {
  effluentSearch,
  flowSearch,
  legacyMapPath,
  parseEffluent,
  parseFlow,
  parseSelection,
  sameEffluent,
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

describe("sub-basin selection", () => {
  it("reads ?s= after ?r= and ?reach=", () => {
    expect(parseSelection(params("s=limay"))).toEqual({
      kind: "subbasin",
      id: "limay",
    });
    expect(parseSelection(params("s=limay&reach=42"))).toEqual({
      kind: "reach",
      id: 42,
    });
    expect(parseSelection(params("s=Bad Id"))).toBeNull();
  });
  it("round-trips and replaces a previous river", () => {
    const sel = { kind: "subbasin", id: "neuquen" } as const;
    const qs = selectionSearch(params("r=negro&foo=1"), sel);
    expect(qs).toBe("?foo=1&s=neuquen");
    expect(parseSelection(params(qs))).toEqual(sel);
  });
});

describe("stream selection", () => {
  it("reads ?t= after ?r= and before ?reach=", () => {
    expect(parseSelection(params("t=arroyo-blanco-61537003"))).toEqual({
      kind: "stream",
      id: "arroyo-blanco-61537003",
    });
    expect(parseSelection(params("r=limay&t=arroyo-blanco-1"))).toEqual({
      kind: "river",
      id: "limay",
    });
    expect(parseSelection(params("t=arroyo-blanco-1&reach=42"))).toEqual({
      kind: "stream",
      id: "arroyo-blanco-1",
    });
    expect(parseSelection(params("t=Bad Id&s=limay"))).toEqual({
      kind: "subbasin",
      id: "limay",
    });
  });
  it("round-trips and replaces a previous selection", () => {
    const sel = { kind: "stream", id: "arroyo-blanco-1" } as const;
    const qs = selectionSearch(params("r=negro&reach=5&foo=1"), sel);
    expect(qs).toBe("?foo=1&t=arroyo-blanco-1");
    expect(parseSelection(params(qs))).toEqual(sel);
    expect(sameSelection(sel, { kind: "river", id: sel.id })).toBe(false);
  });
});

describe("legacyMapPath", () => {
  it.each([
    ["/", "r=limay", "/map"],
    ["/", "reach=61560077", "/map"],
    ["/", "s=neuquen", "/map"],
    ["/", "t=arroyo-blanco-1", "/map"],
    ["/", "", null],
    ["/", "utm_source=x", null],
    ["/map", "r=limay", null],
    ["/attributions", "r=limay", null],
  ])("%s?%s → %s", (path, qs, expected) => {
    expect(legacyMapPath(path, new URLSearchParams(qs))).toBe(expected);
  });
});

describe("flow state", () => {
  it("round-trips flow and fs and keeps the selection", () => {
    const qs = flowSearch(params("r=limay&foo=1"), {
      section: "limay-010",
      speed: 2,
    });
    expect(qs).toBe("?r=limay&foo=1&flow=limay-010&fs=2");
    expect(parseFlow(params(qs))).toEqual({ section: "limay-010", speed: 2 });
    expect(parseSelection(params(qs))).toEqual({ kind: "river", id: "limay" });
    expect(flowSearch(params(qs), { section: "limay-010", speed: 1 })).toBe(
      "?r=limay&foo=1&flow=limay-010",
    );
    expect(selectionSearch(params(qs), null)).toBe(
      "?foo=1&flow=limay-010&fs=2",
    );
  });
  it("drops a bad id and a speed that is not offered", () => {
    expect(parseFlow(params("flow=Bad Id&fs=2"))).toEqual({
      section: null,
      speed: 1,
    });
    expect(parseFlow(params("flow=limay-010&fs=3"))).toEqual({
      section: "limay-010",
      speed: 1,
    });
    expect(
      flowSearch(params("flow=x&fs=2&r=limay"), { section: null, speed: 2 }),
    ).toBe("?r=limay");
  });
});

describe("effluent state", () => {
  it("round-trips every token and keeps the other parameters", () => {
    const ef = {
      reach: 61477479,
      overrides: {
        flowM3s: 2.8,
        bodMgL: 30,
        coliformsPer100mL: 100000,
        doMgL: 2,
        removalPct: 50,
        scenario: { day: 2, stat: "median" as const },
        doMinMgL: 5,
        coliformsThreshold: 1000,
        tempC: 24.5,
        levels: { kd: "high" as const, manningN: "low" as const },
      },
    };
    const qs = effluentSearch(params("r=suquia&foo=1"), ef);
    expect(qs).toBe(
      "?r=suquia&foo=1&ef=61477479_q2.8_b30_c100000_o2_x50_sd3m_td5_tc1000_w24.5_lkh_lnl",
    );
    expect(parseEffluent(params(qs))).toEqual(ef);
    expect(sameEffluent(parseEffluent(params(qs)), ef)).toBe(true);
    expect(parseEffluent(params("ef=61477479_st"))?.overrides.scenario).toBe(
      "today",
    );
    expect(effluentSearch(params(qs), null)).toBe("?r=suquia&foo=1");
  });
  it("writes no defaults and drops invalid tokens, or the whole param for a bad reach", () => {
    expect(effluentSearch(params(""), { reach: 61477479, overrides: {} })).toBe(
      "?ef=61477479",
    );
    expect(
      parseEffluent(params("ef=61477479_x50_q-1_zz_sd0m_lkx_b1e3_lnc")),
    ).toEqual({
      reach: 61477479,
      overrides: { removalPct: 50 },
    });
    expect(parseEffluent(params("ef=abc_x50"))).toBeNull();
    expect(parseEffluent(params("ef=0"))).toBeNull();
    expect(parseEffluent(params("r=suquia"))).toBeNull();
  });
});
