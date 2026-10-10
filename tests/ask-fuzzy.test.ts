import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  catalogEntries,
  createFuzzyIndex,
  editDistance,
  fuzzyMatch,
  nameTerms,
  similarity,
} from "@/lib/ask/fuzzy";
import type { CatalogDocs } from "@/lib/data/queries";

// The real seeded names: data/out is what `npm run seed` loads into Mongo.
const ndjson = (file: string) =>
  readFileSync(`data/out/${file}.ndjson`, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as unknown);

const docs = {
  rivers: ndjson("rivers"),
  subbasins: ndjson("subbasins"),
  streams: ndjson("streams"),
} as CatalogDocs;
const entries = catalogEntries(docs);
const index = createFuzzyIndex(entries);

/** Threshold /api/ask will use to skip the LLM (plan step 4). */
const ASK_THRESHOLD = 0.8;

describe("nameTerms", () => {
  it("normalizes and adds the name without its generic first word", () => {
    expect(nameTerms(["Río Collón Curá", "Collón Curá"])).toEqual([
      "rio collon cura",
      "collon cura",
    ]);
    expect(nameTerms(["Cañadón Grande"])).toEqual(["canadon grande", "grande"]);
  });
});

describe("similarity", () => {
  it("is the edit distance over the longer length", () => {
    expect(editDistance("limai", "limay")).toBe(1);
    expect(similarity("limai", "limay")).toBeCloseTo(0.8);
    expect(similarity("", "")).toBe(1);
    // A prefix is not a match: Fuse alone would score it as perfect.
    expect(similarity("neu", "neuquen")).toBeCloseTo(3 / 7);
  });
});

describe("catalogEntries", () => {
  it("covers every river, sub-basin and stream; endorheic land has no terms", () => {
    expect(entries).toHaveLength(
      docs.rivers.length + docs.subbasins.length + docs.streams.length,
    );
    const endorheic = entries.find(
      (e) => e.kind === "subbasin" && e.id === "endorheic",
    );
    expect(endorheic?.terms).toEqual([]);
  });
});

describe("fuzzyMatch on the seeded names", () => {
  it.each([
    ["collon cura", "collon-cura"],
    ["Collon Cura", "collon-cura"],
    ["colon cura", "collon-cura"],
    ["neuquen", "neuquen"],
    ["rio neuquen", "neuquen"],
    ["limai", "limay"],
    ["chimehuin", "chimehuin"],
    ["pichileufu", "pichileufu"],
    ["Rio Negro", "negro"],
  ])("%s → river %s, confident enough to skip the LLM", (q, id) => {
    const [top] = fuzzyMatch(index, q);
    expect(top?.entry).toMatchObject({ kind: "river", id });
    expect(top?.confidence).toBeGreaterThanOrEqual(ASK_THRESHOLD);
  });

  it("puts a river before its sub-basin of the same name", () => {
    const [first, second] = fuzzyMatch(index, "neuquen");
    expect(first?.entry.kind).toBe("river");
    expect(second?.entry).toMatchObject({ kind: "subbasin", id: "neuquen" });
  });

  it("filters by kind", () => {
    const hits = fuzzyMatch(index, "neuquen", { kinds: ["subbasin"] });
    expect(hits.every((h) => h.entry.kind === "subbasin")).toBe(true);
  });

  it("is not confident about a prefix, a sentence or gibberish", () => {
    for (const q of [
      "neu",
      "show me the biggest tributary of the limay",
      "xqzwv",
    ]) {
      const [top] = fuzzyMatch(index, q);
      expect(top?.confidence ?? 0).toBeLessThan(ASK_THRESHOLD);
    }
  });

  it("returns nothing for an empty query", () => {
    expect(fuzzyMatch(index, "  ")).toEqual([]);
  });
});
