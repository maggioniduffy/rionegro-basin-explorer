import { describe, expect, it } from "vitest";
import { reachSchema, riverSchema } from "@/lib/data/schemas";
import { normalizeSearch, searchTerms } from "@/lib/data/search";
import { chunk, parseNdjson, toRiverDoc, upsertOps } from "../scripts/seed-lib";

const reach = {
  _id: 61523537,
  river: null,
  network: "connected",
  nextDown: 61523580,
  mainRiv: 61560077,
  lengthKm: 0.56,
  distanceToSeaKm: 1315.2,
  uplandKm2: 4.2,
  strahler: 1,
  dischargeM3s: 0.119,
  catchmentMinElevationM: 2170,
  gradientMPerKm: 0,
  upstreamFloodedMinPct: 0,
  upstreamFloodedMaxPct: 0,
  upstreamLakesPct: 0,
  upstreamPopulation: 5,
  regulationPct: 0,
  nonPerennial1d: null,
  nonPerennialProb1d: null,
  nonPerennial30d: 0,
  nonPerennialProb30d: 0.437,
};

describe("normalizeSearch", () => {
  it("drops accents, case and extra spaces", () => {
    expect(normalizeSearch("  Río  Collón Curá ")).toBe("rio collon cura");
    expect(normalizeSearch("NEUQUÉN")).toBe("neuquen");
  });
  it("keeps distinct names only", () => {
    expect(searchTerms(["Río Negro", "Negro", "negro"])).toEqual([
      "rio negro",
      "negro",
    ]);
  });
});

describe("parseNdjson", () => {
  it("parses valid lines and skips blank ones", () => {
    const text = `${JSON.stringify(reach)}\n\n`;
    expect(parseNdjson(text, reachSchema)).toEqual([reach]);
  });
  it("rejects unknown fields and names the line", () => {
    const text = `${JSON.stringify(reach)}\n${JSON.stringify({ ...reach, extra: 1 })}\n`;
    expect(() => parseNdjson(text, reachSchema)).toThrow(/^line 2:/);
  });
  it("rejects a missing field", () => {
    const missing: Partial<typeof reach> = { ...reach };
    delete missing.regulationPct;
    expect(() => parseNdjson(JSON.stringify(missing), reachSchema)).toThrow();
  });
});

describe("upsertOps", () => {
  it("replaces whole documents by _id with upsert", () => {
    expect(upsertOps([{ _id: 1, a: 2 }])).toEqual([
      {
        replaceOne: {
          filter: { _id: 1 },
          replacement: { _id: 1, a: 2 },
          upsert: true,
        },
      },
    ]);
  });
  it("is deterministic, so a re-run replaces with identical documents", () => {
    const docs = [{ _id: "negro", n: 1 }];
    expect(upsertOps(docs)).toEqual(upsertOps(structuredClone(docs)));
  });
});

describe("toRiverDoc", () => {
  it("adds search terms from name and short name", async () => {
    const { readFile } = await import("node:fs/promises");
    const [first] = parseNdjson(
      await readFile("data/out/rivers.ndjson", "utf8"),
      riverSchema,
    );
    expect(toRiverDoc(first!).searchTerms).toEqual(["rio negro", "negro"]);
  });
});

describe("chunk", () => {
  it("splits into batches", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});
