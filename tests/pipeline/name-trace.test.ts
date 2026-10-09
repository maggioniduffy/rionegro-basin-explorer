import { describe, expect, it } from "vitest";
import {
  type NameTraceInput,
  type ReachKind,
  traceAlongName,
} from "../../pipeline/lib/name-trace";

/** A reach: id, the reach downstream, its kind, km × coverage, upland area. */
interface R {
  id: number;
  down: number;
  kind: ReachKind;
  evidence?: number;
  area?: number;
}

const input = (reaches: R[]): NameTraceInput => {
  const by = new Map(reaches.map((r) => [r.id, r]));
  const ups = new Map<number, number[]>();
  for (const r of reaches) ups.set(r.down, [...(ups.get(r.down) ?? []), r.id]);
  return {
    upstream: (id) => ups.get(id) ?? [],
    kind: (id) => by.get(id)?.kind ?? "blocked",
    evidence: (id) => by.get(id)?.evidence ?? 1,
    area: (id) => by.get(id)?.area ?? 0,
  };
};
const trace = (reaches: R[], start = 1, maxGap = 2, leading = true) =>
  traceAlongName(start, input(reaches), {
    maxGap,
    unlimitedLeadingGap: leading,
  }).path;

describe("traceAlongName (approved rivers)", () => {
  it("stops where the name ends, and drops the unnamed reaches above it", () => {
    // 1 ← 2 ← 3 (name) ← 4 ← 5 (no name, headwater)
    expect(
      trace([
        { id: 1, down: 0, kind: "strong" },
        { id: 2, down: 1, kind: "strong" },
        { id: 3, down: 2, kind: "strong" },
        { id: 4, down: 3, kind: "gap" },
        { id: 5, down: 4, kind: "gap" },
      ]),
    ).toEqual([1, 2, 3]);
  });

  it("keeps up to 2 unnamed reaches between two named ones, not 3", () => {
    const chain = (gaps: number): R[] => [
      { id: 1, down: 0, kind: "strong" },
      ...Array.from({ length: gaps }, (_, i) => ({
        id: 2 + i,
        down: 1 + i,
        kind: "gap" as const,
      })),
      { id: 2 + gaps, down: 1 + gaps, kind: "strong" },
    ];
    expect(trace(chain(2))).toEqual([1, 2, 3, 4]);
    expect(trace(chain(3))).toEqual([1]);
  });

  it("stops at a lake whose far side has another name (Chimehuín, Paimún)", () => {
    // mouth 1, 2 named; 3, 4, 5 in the lake; 6 is the Paimún (another name: a gap here)
    expect(
      trace([
        { id: 1, down: 0, kind: "strong" },
        { id: 2, down: 1, kind: "strong" },
        { id: 3, down: 2, kind: "lake" },
        { id: 4, down: 3, kind: "lake" },
        { id: 5, down: 4, kind: "lake" },
        { id: 6, down: 5, kind: "gap" },
      ]),
    ).toEqual([1, 2]);
  });

  it("crosses a reservoir of any length when the name goes on above it", () => {
    const lake = Array.from({ length: 6 }, (_, i) => ({
      id: 3 + i,
      down: 2 + i,
      kind: "lake" as const,
    }));
    expect(
      trace([
        { id: 1, down: 0, kind: "strong" },
        { id: 2, down: 1, kind: "strong" },
        ...lake,
        { id: 9, down: 8, kind: "strong" },
      ]),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("keeps weak reaches only between named ones", () => {
    // 1 ← 2 (weak) ← 3 ← 4 (weak, end)
    expect(
      trace([
        { id: 1, down: 0, kind: "strong" },
        { id: 2, down: 1, kind: "weak" },
        { id: 3, down: 2, kind: "strong" },
        { id: 4, down: 3, kind: "weak" },
      ]),
    ).toEqual([1, 2, 3]);
  });

  it("follows the IGN line at a fork, not the larger area", () => {
    // At 2: branch 3 (area 900, no name) and branch 4 (area 100, the name)
    expect(
      trace([
        { id: 1, down: 0, kind: "strong" },
        { id: 2, down: 1, kind: "strong" },
        { id: 3, down: 2, kind: "gap", area: 900 },
        { id: 5, down: 3, kind: "gap", area: 900 },
        { id: 4, down: 2, kind: "strong", area: 100 },
      ]),
    ).toEqual([1, 2, 4]);
  });

  it("takes the branch with more IGN evidence when both carry the name", () => {
    expect(
      trace([
        { id: 1, down: 0, kind: "strong" },
        { id: 2, down: 1, kind: "strong", evidence: 1, area: 900 },
        { id: 3, down: 1, kind: "strong", evidence: 0.5, area: 100 },
        { id: 4, down: 3, kind: "strong", evidence: 4, area: 90 },
      ]),
    ).toEqual([1, 3, 4]);
  });

  it("breaks ties by area", () => {
    expect(
      trace([
        { id: 1, down: 0, kind: "strong" },
        { id: 2, down: 1, kind: "strong", area: 10 },
        { id: 3, down: 1, kind: "strong", area: 20 },
      ]),
    ).toEqual([1, 3]);
  });

  it("never trims the mouth end: leading reaches without the name are kept", () => {
    // mouth 1 and 2, 3, 4 have no IGN line (3 gaps), then the name
    expect(
      trace([
        { id: 1, down: 0, kind: "gap" },
        { id: 2, down: 1, kind: "gap" },
        { id: 3, down: 2, kind: "gap" },
        { id: 4, down: 3, kind: "gap" },
        { id: 5, down: 4, kind: "strong" },
        { id: 6, down: 5, kind: "gap" },
      ]),
    ).toEqual([1, 2, 3, 4, 5]);
    // …which only the leading option allows (here 3 gaps above the start)
    expect(
      trace(
        [
          { id: 1, down: 0, kind: "gap" },
          { id: 2, down: 1, kind: "gap" },
          { id: 3, down: 2, kind: "gap" },
          { id: 4, down: 3, kind: "gap" },
          { id: 5, down: 4, kind: "strong" },
        ],
        1,
        2,
        false,
      ),
    ).toEqual([1]);
  });

  it("keeps just the mouth when the name never appears", () => {
    expect(
      trace([
        { id: 1, down: 0, kind: "gap" },
        { id: 2, down: 1, kind: "gap" },
      ]),
    ).toEqual([1]);
  });

  it("never enters a blocked reach (another approved river's mouth)", () => {
    expect(
      trace([
        { id: 1, down: 0, kind: "strong" },
        { id: 2, down: 1, kind: "blocked", area: 900 },
        { id: 3, down: 2, kind: "strong" },
        { id: 4, down: 1, kind: "gap", area: 10 },
      ]),
    ).toEqual([1]);
  });
});
