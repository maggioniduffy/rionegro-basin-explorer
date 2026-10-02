import { describe, expect, it } from "vitest";
import {
  applyOverride,
  classify,
  type MatchConfig,
} from "../../pipeline/lib/ign-match";

const cfg: MatchConfig = {
  bufferM: 250,
  high: { minCoverage: 0.8, minMargin: 0.3 },
  medium: { minCoverage: 0.3, minMargin: 0.3 },
  low: { minCoverage: 0.2 },
  riverNameMinShare: 0.6,
  riverNameMinEvidenceKm: 50,
  minDetailPieceM: 500,
};
const c = (key: string, coverage: number) => ({ key, coverage });

describe("classify", () => {
  it("returns none without candidates or below the low threshold", () => {
    expect(classify([], cfg).confidence).toBe("none");
    expect(classify([c("a", 0.1)], cfg)).toMatchObject({
      best: null,
      confidence: "none",
    });
  });

  it("is high with strong coverage and a clear lead", () => {
    expect(classify([c("a", 0.95), c("b", 0.2)], cfg)).toMatchObject({
      confidence: "high",
      ambiguous: false,
    });
    expect(classify([c("a", 0.9)], cfg).confidence).toBe("high");
  });

  it("is medium with moderate coverage or a smaller lead", () => {
    expect(classify([c("a", 0.6)], cfg).confidence).toBe("medium");
    expect(classify([c("a", 0.7), c("b", 0.3)], cfg).confidence).toBe("medium");
  });

  it("is low and ambiguous when two names cover the reach about equally", () => {
    const r = classify([c("a", 0.9), c("b", 0.85)], cfg);
    expect(r.confidence).toBe("low");
    expect(r.ambiguous).toBe(true);
    expect(r.margin).toBeCloseTo(0.05);
  });

  it("is low for weak coverage without a competitor", () => {
    expect(classify([c("a", 0.25)], cfg)).toMatchObject({
      confidence: "low",
      ambiguous: false,
    });
  });

  it("is monotonic: lowering a threshold never lowers the tier", () => {
    const loose = { ...cfg, high: { minCoverage: 0.7, minMargin: 0.2 } };
    const cands = [c("a", 0.75), c("b", 0.4)];
    expect(classify(cands, cfg).confidence).toBe("medium");
    expect(classify(cands, loose).confidence).toBe("high");
  });
});

describe("applyOverride", () => {
  const low = { name: "Arroyo X", confidence: "low" as const };
  const high = { name: "Arroyo Y", confidence: "high" as const };

  it("shows high and medium by default, hides low and none", () => {
    expect(applyOverride(high, undefined)).toMatchObject({
      display: true,
      reviewed: false,
    });
    expect(applyOverride(low, undefined).display).toBe(false);
    expect(
      applyOverride({ name: null, confidence: "none" }, undefined).display,
    ).toBe(false);
  });

  it("accept shows a low match, reject hides a high one", () => {
    expect(
      applyOverride(low, { id: 1, action: "accept", note: "checked" }),
    ).toMatchObject({ display: true, reviewed: true, name: "Arroyo X" });
    expect(
      applyOverride(high, { id: 1, action: "reject", note: "wrong river" }),
    ).toMatchObject({ display: false, reviewed: true });
  });

  it("name replaces the candidate and keeps the computed confidence", () => {
    expect(
      applyOverride(low, {
        id: 1,
        action: "name",
        name: "Arroyo Z",
        note: "braided reach",
      }),
    ).toEqual({
      name: "Arroyo Z",
      confidence: "low",
      reviewed: true,
      display: true,
    });
  });
});
