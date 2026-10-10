import { describe, expect, it } from "vitest";
import {
  reachSchema,
  riverSchema,
  streamSchema,
  subbasinSchema,
} from "@/lib/data/schemas";
import { normalizeSearch, searchTerms } from "@/lib/data/search";
import {
  chunk,
  parseNdjson,
  toRiverDoc,
  toStreamDoc,
  upsertOps,
} from "../scripts/seed-lib";

const reach = {
  _id: 61523537,
  river: null,
  stream: null,
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
    // "none": an owner-named reach that no IGN line carries (Río Correntoso).
    const owner = { ...named, ign: { ...named.ign, confidence: "none" } };
    expect(parseNdjson(JSON.stringify(owner), reachSchema)).toEqual([owner]);
    const bad = { ...named, ign: { ...named.ign, confidence: "certain" } };
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

describe("streams", () => {
  const stream = {
    _id: "arroyo-nireco-61533765",
    name: "Arroyo Ñireco",
    mouthReach: 61533765,
    reachCount: 25,
    lengthKm: 134.9,
    subbasin: "limay",
    receivingRiver: "limay",
    mouth: {
      elevationM: 770,
      dischargeM3s: 1.2,
      uplandKm2: 310.4,
      distanceToSeaKm: 640.2,
      strahler: 4,
      regulationPct: 0,
    },
    watershed: {
      floodedMinPct: 0,
      floodedMaxPct: 1,
      lakesPct: 0.5,
      population: 1200,
    },
    bbox: [-71.36875, -41.25, -70.36458, -36.72292] as [
      number,
      number,
      number,
      number,
    ],
    modeled: ["mouth.dischargeM3s"],
    provenance: { lengthKm: "HydroRIVERS v1.0 LENGTH_KM, summed" },
  };
  it("validates a document and rejects unknown fields", () => {
    expect(parseNdjson(JSON.stringify(stream), streamSchema)).toEqual([stream]);
    expect(() =>
      parseNdjson(JSON.stringify({ ...stream, extra: 1 }), streamSchema),
    ).toThrow();
  });
  it("allows no sub-basin or receiving river, but not a bad id", () => {
    const open = { ...stream, subbasin: null, receivingRiver: null };
    expect(parseNdjson(JSON.stringify(open), streamSchema)).toEqual([open]);
    expect(() =>
      parseNdjson(JSON.stringify({ ...stream, _id: "Bad Id" }), streamSchema),
    ).toThrow();
  });
  it("adds accent-free search terms, so 'nireco' finds 'Ñireco'", () => {
    expect(toStreamDoc(stream).searchTerms).toEqual(["arroyo nireco"]);
  });
  it("tags a reach with its stream, or null", () => {
    const tagged = { ...reach, stream: "arroyo-nireco-61533765" };
    expect(parseNdjson(JSON.stringify(tagged), reachSchema)).toEqual([tagged]);
    const { stream: _omit, ...untagged } = reach;
    void _omit;
    expect(() => parseNdjson(JSON.stringify(untagged), reachSchema)).toThrow();
  });
});
