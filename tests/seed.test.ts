import { describe, expect, it } from "vitest";
import {
  ignNameSchema,
  reachSchema,
  riverSchema,
  subbasinSchema,
} from "@/lib/data/schemas";
import { normalizeSearch, searchTerms } from "@/lib/data/search";
import {
  chunk,
  parseNdjson,
  toIgnNameDoc,
  toRiverDoc,
  upsertOps,
} from "../scripts/seed-lib";

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
  bbox: [-71.1, -39.2, -71.09, -39.19],
  ign: null,
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
  it("accepts an IGN name on a reach and rejects an unknown confidence", () => {
    const named = {
      ...reach,
      ign: { name: "Arroyo Ñireco", confidence: "high", reviewed: false },
    };
    expect(parseNdjson(JSON.stringify(named), reachSchema)).toEqual([named]);
    const bad = { ...named, ign: { ...named.ign, confidence: "none" } };
    expect(() => parseNdjson(JSON.stringify(bad), reachSchema)).toThrow();
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

describe("subbasinSchema", () => {
  it("accepts the committed pipeline output", async () => {
    const { readFile } = await import("node:fs/promises");
    const text = await readFile("data/out/subbasins.ndjson", "utf8");
    const docs = parseNdjson(text, subbasinSchema);
    expect(docs.map((d) => d._id).slice(0, 4)).toEqual([
      "negro",
      "limay",
      "neuquen",
      "endorheic",
    ]);
    expect(docs.length).toBe(25);
    expect(docs.find((d) => d._id === "alumine")).toMatchObject({
      level: 3,
      parentId: "collon-cura",
      path: ["negro", "limay", "collon-cura", "alumine"],
    });
    expect(docs.find((d) => d._id === "malleo")?.level).toBe(4);
    const endo = docs.find((d) => d.kind === "endorheic");
    expect(endo).toMatchObject({ name: null, river: null, outlet: null });
    expect(docs[0]?.parentId).toBeNull();
  });
});

describe("IGN names", () => {
  const name = {
    _id: "arroyo-nireco",
    name: "Arroyo Ñireco",
    reachCount: 25,
    lengthKm: 134.9,
    longestReach: 61533765,
    bbox: [-71.36875, -41.25, -70.36458, -36.72292] as [
      number,
      number,
      number,
      number,
    ],
  };
  it("validates a document and rejects unknown fields", () => {
    expect(parseNdjson(JSON.stringify(name), ignNameSchema)).toEqual([name]);
    expect(() =>
      parseNdjson(JSON.stringify({ ...name, extra: 1 }), ignNameSchema),
    ).toThrow();
  });
  it("adds accent-free search terms, so 'nireco' finds 'Ñireco'", () => {
    expect(toIgnNameDoc(name).searchTerms).toEqual(["arroyo nireco"]);
  });
});
