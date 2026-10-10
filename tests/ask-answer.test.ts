import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Catalog } from "@/lib/ask/catalog";
import type { Intent } from "@/lib/ask/intent";
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
  readFileSync(`data/out/nqn/${file}.ndjson`, "utf8")
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
  const read = (d: Doc, path: string) =>
    path === mainPath && mongo.overrides.has(d._id)
      ? (mongo.overrides.get(d._id) ?? null)
      : at(d, path);
  let mainPath = "";
  getMetricDocs.mockImplementation(
    async (kind: "river" | "subbasin", ids: string[], paths: string[]) => {
      const source = (kind === "river" ? rivers : subbasins) as Doc[];
      const main = paths[0];
      mainPath = main ?? "";
      return source
        .filter((d) => ids.includes(d._id))
        .map((d): MetricDoc => ({
          id: d._id,
          name: d.name ?? null,
          value: main === undefined ? null : read(d, main),
          values: Object.fromEntries(paths.map((p) => [p, read(d, p)])),
          modeled: main !== undefined && d.modeled.includes(main),
          provenance: main === undefined ? null : (d.provenance[main] ?? null),
          lineage: kind === "subbasin" ? (d["path"] as string[]) : null,
          rivers: kind === "subbasin" ? (d["rivers"] as string[]) : null,
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

  describe("rank filters", () => {
    type RankFilters = Extract<Intent, { action: "rank" }>["filters"];
    const rank = (
      filters: RankFilters,
      over: Partial<Extract<Intent, { action: "rank" }>> = {},
    ) =>
      computeAnswer(
        {
          action: "rank",
          kind: "river",
          scope: "all",
          metric: "length",
          order: "max",
          filters,
          ...over,
        },
        catalog,
      );
    const num = (d: Doc, key: string) => d[key] as number;
    const sub = (id: string) => subbasins.find((s) => s._id === id) as Doc;
    const byLength = (a: Doc, b: Doc) =>
      num(b, "lengthKm") - num(a, "lengthKm");

    it("perennial excludes every river with an orange share, by data", async () => {
      const mixed = rivers.filter((r) => num(r, "nonPerennialPct") > 0);
      expect(mixed.length).toBeGreaterThan(0);
      const answer = await rank([{ type: "regime", value: "perennial" }], {
        order: "min",
      });
      const perennial = rivers.filter(
        (r) => num(r, "nonPerennialPct") === 0 && num(r, "unknownPct") === 0,
      );
      const shortest = [...perennial].sort((a, b) => -byLength(a, b))[0] as Doc;
      expect(answer.total).toBe(perennial.length);
      expect(answer.items[0]?.id).toBe(shortest._id);
      expect(answer.items[0]?.value).toBe(num(shortest, "lengthKm"));
      const ids = answer.items.map((i) => i.id);
      for (const m of mixed) expect(ids).not.toContain(m._id);
      expect(answer.filterCaveats).toEqual(["nonPerennial"]);
      expect(answer.filters).toEqual([{ type: "regime", value: "perennial" }]);
    });

    it("nonPerennial returns exactly the rivers with an orange share", async () => {
      const expected = rivers.filter((r) => num(r, "nonPerennialPct") > 0);
      const answer = await rank([{ type: "regime", value: "nonPerennial" }], {
        order: "max",
      });
      expect(answer.total).toBe(expected.length);
      expect(answer.items).toHaveLength(Math.min(10, expected.length));
      const top = [...expected].sort(byLength).slice(0, 10);
      expect(answer.items.map((i) => i.id)).toEqual(top.map((r) => r._id));
      for (const item of answer.items) {
        expect(item.nonPerennialPct).toBe(
          num(river(item.id), "nonPerennialPct"),
        );
      }
    });

    it("regulated yes keeps the rivers with reservoir storage upstream", async () => {
      const expected = rivers.filter((r) => at(r, "mouth.regulationPct")! > 0);
      const none = rivers.filter((r) => at(r, "mouth.regulationPct") === 0);
      expect(expected.length).toBeGreaterThan(0);
      const yes = await rank([{ type: "regulated", value: "yes" }]);
      expect(yes.total).toBe(expected.length);
      expect(yes.filterCaveats).toEqual(["regulation"]);
      expect(yes.items[0]?.nonPerennialPct).toBeUndefined();
      const no = await rank([{ type: "regulated", value: "no" }]);
      expect(no.total).toBe(none.length);
    });

    it("within limay keeps only the rivers listed in the sub-basin", async () => {
      const inside = sub("limay")["rivers"] as string[];
      const answer = await rank([{ type: "within", slug: "limay" }]);
      expect(answer.total).toBe(inside.length);
      for (const item of answer.items) expect(inside).toContain(item.id);
    });

    it("threshold gt 100 on length is strict", async () => {
      const expected = rivers.filter((r) => num(r, "lengthKm") > 100);
      const answer = await rank([
        { type: "threshold", metric: "length", op: "gt", number: 100 },
      ]);
      expect(answer.total).toBe(expected.length);
      for (const item of answer.items) {
        expect(item.value).toBeGreaterThan(100);
      }
      const below = await rank([
        { type: "threshold", metric: "length", op: "lt", number: 100 },
      ]);
      expect(below.total).toBe(
        rivers.filter((r) => num(r, "lengthKm") < 100).length,
      );
    });

    it("combines within and threshold (AND)", async () => {
      const inside = new Set(sub("limay")["rivers"] as string[]);
      const expected = rivers.filter(
        (r) => inside.has(r._id) && num(r, "lengthKm") > 100,
      );
      const answer = await rank([
        { type: "within", slug: "limay" },
        { type: "threshold", metric: "length", op: "gt", number: 100 },
      ]);
      expect(answer.total).toBe(expected.length);
      expect(answer.items.map((i) => i.id)).toEqual(
        [...expected]
          .sort(byLength)
          .slice(0, 10)
          .map((r) => r._id),
      );
    });

    it("answers zero matches with no items and total 0", async () => {
      const answer = await rank([
        { type: "threshold", metric: "length", op: "gt", number: 1e9 },
      ]);
      expect(answer.items).toEqual([]);
      expect(answer.winnerIds).toEqual([]);
      expect(answer.total).toBe(0);
    });

    it("never matches a document missing the field", async () => {
      mongo.overrides.set("agrio", null);
      const answer = await rank([
        { type: "threshold", metric: "length", op: "gt", number: 0 },
      ]);
      expect(answer.items.map((i) => i.id)).not.toContain("agrio");
      expect(answer.total).toBe(rivers.length - 1);
    });

    it("filters sub-basins within another by their path", async () => {
      const expected = subbasins.filter(
        (s) => s._id !== "limay" && (s["path"] as string[]).includes("limay"),
      );
      expect(expected.length).toBeGreaterThan(0);
      const answer = await rank([{ type: "within", slug: "limay" }], {
        kind: "subbasin",
        metric: "area",
      });
      expect(answer.total).toBe(expected.length);
      const top = [...expected]
        .sort((a, b) => num(b, "areaKm2") - num(a, "areaKm2"))
        .slice(0, 10);
      expect(answer.items.map((i) => i.id)).toEqual(top.map((s) => s._id));
    });

    it("has no filters and shows 5 without them", async () => {
      const answer = await rank(undefined);
      expect(answer.filters).toEqual([]);
      expect(answer.filterCaveats).toEqual([]);
      expect(answer.items).toHaveLength(5);
      expect(answer.total).toBe(rivers.length);
    });

    it("leaves compare and fact without a total", async () => {
      const fact = await computeAnswer(
        { action: "fact", kind: "river", slug: "neuquen", metric: "length" },
        catalog,
      );
      expect(fact.total).toBeNull();
      expect(fact.filters).toEqual([]);
    });
  });
});
