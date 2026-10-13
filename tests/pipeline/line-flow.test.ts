import { describe, expect, it } from "vitest";
import { flowCode, pieceFlow, reachFlows } from "../../pipeline/lib/line-flow";

describe("pieceFlow", () => {
  it("takes the class with more points when enough points lie by an IGN line", () => {
    expect(pieceFlow(10, 6, 0, 0.5)).toBe("perennial");
    expect(pieceFlow(10, 1, 5, 0.5)).toBe("intermittent");
  });

  it("gives a tie to perennial", () => {
    expect(pieceFlow(10, 3, 3, 0.5)).toBe("perennial");
  });

  it("is null when the piece runs apart from IGN's lines", () => {
    expect(pieceFlow(10, 2, 2, 0.5)).toBeNull();
    expect(pieceFlow(0, 0, 0, 0.5)).toBeNull();
  });

  it("codes the class as GIRES's nonPerennial1d", () => {
    expect(flowCode("perennial")).toBe(0);
    expect(flowCode("intermittent")).toBe(1);
  });
});

describe("reachFlows", () => {
  it("gives each reach the class with more piece length, a tie to perennial", () => {
    const m = reachFlows([
      { reach: 1, flow: "perennial", lengthM: 300 },
      { reach: 1, flow: "intermittent", lengthM: 500 },
      { reach: 2, flow: "perennial", lengthM: 200 },
      { reach: 2, flow: "intermittent", lengthM: 200 },
    ]);
    expect(m.get(1)).toBe("intermittent");
    expect(m.get(2)).toBe("perennial");
    expect(m.has(3)).toBe(false);
  });
});
