import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Catalog } from "@/lib/ask/catalog";
import type { CatalogDocs, MetricDoc } from "@/lib/data/queries";

vi.mock("server-only", () => ({}));

interface Doc {
  _id: string;
  name?: string | null;
  parentId?: string | null;
  flowsInto?: string;
  modeled: string[];
  provenance: Record<string, string>;
  [key: string]: unknown;
}

const ndjson = (file: string) =>
  readFileSync(`data/out/${file}.ndjson`, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Doc);
const rivers = ndjson("rivers");
const subbasins = ndjson("subbasins");
const docs = { rivers, subbasins, streams: ndjson("streams") };

const at = (doc: unknown, path: string): number | null => {
  let node = doc;
  for (const key of path.split(".")) {
    if (typeof node !== "object" || node === null) return null;
    node = (node as Record<string, unknown>)[key];
  }
  return typeof node === "number" && Number.isFinite(node) ? node : null;
};

// Stand-in for Mongo: the real seeded documents, with optional per-test overrides.
const mongo = vi.hoisted(() => ({
  overrides: new Map<string, number | null>(),
}));
const getMetricDocs = vi.hoisted(() => vi.fn());
vi.mock("@/lib/data/queries", () => ({ getMetricDocs }));

const { buildCatalog } = await import("@/lib/ask/catalog");
const { computeAnswer } = await import("@/lib/ask/server/answer");
const catalog: Catalog = buildCatalog(docs as unknown as CatalogDocs);

beforeEach(() => {
  mongo.overrides.clear();
  getMetricDocs.mockReset();
  getMetricDocs.mockImplementation(
    async (kind: "river" | "subbasin", ids: string[], path: string) => {
      const source = (kind === "river" ? rivers : subbasins) as Doc[];
      return source
        .filter((d) => ids.includes(d._id))
        .map((d): MetricDoc => ({
          id: d._id,
          name: d.name ?? null,
          value: mongo.overrides.has(d._id)
            ? (mongo.overrides.get(d._id) ?? null)
            : at(d, path),
          modeled: d.modeled.includes(path),
          provenance: d.provenance[path] ?? null,
        }));
    },
  );
});

const river = (id: string) => rivers.find((r) => r._id === id) as Doc;
const lengthOf = (id: string) => river(id)["lengthKm"] as number;

describe("computeAnswer", () => {
  it("compares two rivers by seeded length, longest first", async () => {
    const answer = await computeAnswer(
      {
        action: "compare",
        kind: "river",
        slugs: ["caleufu", "agrio"],
        metric: "length",
        order: "max",
      },
      catalog,
    );
    const longer =
      lengthOf("caleufu") > lengthOf("agrio") ? "caleufu" : "agrio";
    expect(answer.type).toBe("compare");
    expect(answer.winnerIds).toEqual([longer]);
    expect(answer.items.map((i) => i.value)).toEqual(
      [lengthOf("caleufu"), lengthOf("agrio")].sort((a, b) => b - a),
    );
    expect(answer.items[0]?.id).toBe(longer);
    expect(answer.parent).toBeNull();
    expect(answer.provenance).toBe(river(longer).provenance["lengthKm"]);
  });

  it("orders ascending for min", async () => {
    const answer = await computeAnswer(
      {
        action: "compare",
        kind: "river",
        slugs: ["caleufu", "agrio"],
        metric: "length",
        order: "min",
      },
      catalog,
    );
    expect(answer.winnerIds).toEqual(["caleufu"]);
    expect(answer.items.map((i) => i.id)).toEqual(["caleufu", "agrio"]);
  });

  it("ranks only the tributaries of a river, at most 5, sorted", async () => {
    const answer = await computeAnswer(
      {
        action: "rank",
        kind: "river",
        scope: "tributaries",
        slug: "limay",
        metric: "length",
        order: "max",
      },
      catalog,
    );
    const expected = rivers.filter((r) => r.flowsInto === "limay");
    expect(expected.length).toBeGreaterThan(0);
    expect(answer.items.length).toBeLessThanOrEqual(5);
    expect(answer.items.length).toBe(Math.min(5, expected.length));
    for (const item of answer.items) {
      expect(river(item.id).flowsInto).toBe("limay");
    }
    const values = answer.items.map((i) => i.value ?? -1);
    expect(values).toEqual([...values].sort((a, b) => b - a));
    expect(answer.parent).toEqual({ id: "limay", name: river("limay").name });
    expect(answer.winnerIds).toEqual([answer.items[0]?.id]);
  });

  it("keeps the top 5 of a larger set", async () => {
    const answer = await computeAnswer(
      {
        action: "rank",
        kind: "river",
        scope: "all",
        metric: "length",
        order: "max",
      },
      catalog,
    );
    expect(answer.items).toHaveLength(5);
    const top = rivers
      .map((r) => r["lengthKm"] as number)
      .sort((a, b) => b - a)
      .slice(0, 5);
    expect(answer.items.map((i) => i.value)).toEqual(top);
  });

  it("ranks all sub-basins without the root", async () => {
    const answer = await computeAnswer(
      {
        action: "rank",
        kind: "subbasin",
        scope: "all",
        metric: "area",
        order: "max",
      },
      catalog,
    );
    const rootId = subbasins.find((s) => s.parentId === null)?._id;
    expect(rootId).toBeDefined();
    expect(answer.items.map((i) => i.id)).not.toContain(rootId);
    const areas = subbasins
      .filter((s) => s.parentId !== null)
      .map((s) => s["areaKm2"] as number)
      .sort((a, b) => b - a);
    expect(answer.items[0]?.value).toBe(areas[0]);
  });

  it("answers an empty tributary list with no items", async () => {
    const leaf = rivers.find(
      (r) => !rivers.some((o) => o.flowsInto === r._id),
    ) as Doc;
    const answer = await computeAnswer(
      {
        action: "rank",
        kind: "river",
        scope: "tributaries",
        slug: leaf._id,
        metric: "length",
        order: "max",
      },
      catalog,
    );
    expect(answer.items).toEqual([]);
    expect(answer.winnerIds).toEqual([]);
    expect(answer.parent?.id).toBe(leaf._id);
    expect(getMetricDocs).not.toHaveBeenCalled();
  });

  it("returns a modeled fact with its provenance", async () => {
    const answer = await computeAnswer(
      { action: "fact", kind: "river", slug: "neuquen", metric: "discharge" },
      catalog,
    );
    const neuquen = river("neuquen");
    expect(answer.type).toBe("fact");
    expect(answer.order).toBeNull();
    expect(answer.items).toEqual([
      {
        id: "neuquen",
        name: neuquen.name,
        value: at(neuquen, "mouth.dischargeM3s"),
        modeled: true,
      },
    ]);
    expect(answer.winnerIds).toEqual(["neuquen"]);
    expect(answer.provenance).toBe(neuquen.provenance["mouth.dischargeM3s"]);
    expect(answer.provenance).not.toBeNull();
  });

  it("sorts a missing value last and never makes it the winner", async () => {
    mongo.overrides.set("agrio", null);
    const answer = await computeAnswer(
      {
        action: "compare",
        kind: "river",
        slugs: ["agrio", "caleufu"],
        metric: "length",
        order: "min",
      },
      catalog,
    );
    expect(answer.items.map((i) => i.id)).toEqual(["caleufu", "agrio"]);
    expect(answer.items[1]?.value).toBeNull();
    expect(answer.winnerIds).toEqual(["caleufu"]);
  });

  it("has no winner when no item has a value", async () => {
    mongo.overrides.set("agrio", null);
    mongo.overrides.set("caleufu", null);
    const answer = await computeAnswer(
      { action: "fact", kind: "river", slug: "agrio", metric: "length" },
      catalog,
    );
    expect(answer.winnerIds).toEqual([]);
    expect(answer.provenance).not.toBeNull();
  });

  it("lists every id sharing the best value on a tie", async () => {
    mongo.overrides.set("agrio", 100);
    mongo.overrides.set("caleufu", 100);
    const answer = await computeAnswer(
      {
        action: "compare",
        kind: "river",
        slugs: ["agrio", "caleufu"],
        metric: "length",
        order: "max",
      },
      catalog,
    );
    expect([...answer.winnerIds].sort()).toEqual(["agrio", "caleufu"]);
  });
});
