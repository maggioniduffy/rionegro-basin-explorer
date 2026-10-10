import { beforeEach, describe, expect, it, vi } from "vitest";

// `server-only` throws outside a react-server bundle; it is only a marker here.
vi.mock("server-only", () => ({}));

// A tiny in-memory stand-in for the collections searchNames reads.
type Doc = Record<string, unknown> & { _id: unknown };
const data: Record<string, Doc[]> = {
  reaches: [],
  rivers: [],
  streams: [],
  subbasins: [],
};
const calls: string[] = [];

function collection(name: string) {
  const match = (filter: Record<string, unknown>) => (d: Doc) => {
    const id = filter._id as { $in?: unknown[] } | unknown;
    if (id && typeof id === "object" && "$in" in id)
      return (id as { $in: unknown[] }).$in.includes(d._id);
    return d._id === id;
  };
  return {
    findOne: async (filter: Record<string, unknown>) => {
      calls.push(`${name}.findOne`);
      return data[name]!.find(match(filter)) ?? null;
    },
    find: (filter: Record<string, unknown>) => {
      calls.push(`${name}.find`);
      // Name searches (no _id) return every stored document, as a prefix match would.
      const docs =
        "_id" in filter ? data[name]!.filter(match(filter)) : data[name]!;
      const cursor = {
        sort: () => cursor,
        limit: () => cursor,
        toArray: async () => docs,
      };
      return cursor;
    },
  };
}

vi.mock("@/lib/mongo", () => ({
  getDb: async () => ({ collection }),
}));

const { searchNames } = await import("@/lib/data/queries");

const bbox = [-70, -40, -69, -39];

beforeEach(() => {
  calls.length = 0;
  data.reaches = [
    { _id: 61537003, river: null, ign: { name: "Arroyo Blanco" }, bbox },
    { _id: 61528155, river: "varvarco", ign: null, bbox },
    { _id: 61500001, river: null, ign: null, bbox },
  ];
  data.rivers = [{ _id: "varvarco", name: "Río Varvarco" }];
});

describe("searchNames with a HYRIV_ID", () => {
  it("returns the reach with its IGN name", async () => {
    expect(await searchNames("nqn", "61537003")).toEqual([
      { kind: "reachId", id: "61537003", name: "Arroyo Blanco", bbox },
    ]);
    // Digits only: no name search.
    expect(calls).toEqual(["reaches.findOne"]);
  });

  it("falls back to the river's name, then to none", async () => {
    expect((await searchNames("nqn", "61528155"))[0]?.name).toBe(
      "Río Varvarco",
    );
    expect((await searchNames("nqn", "61500001"))[0]?.name).toBeNull();
  });

  it("returns nothing for an unknown or invalid id", async () => {
    expect(await searchNames("nqn", "12345")).toEqual([]);
    expect(await searchNames("nqn", "0123")).toEqual([]);
    expect(calls).toEqual(["reaches.findOne"]);
  });
});

describe("searchNames with a name", () => {
  it("returns streams with the sub-basin of their mouth, longest first", async () => {
    data.rivers = [{ _id: "varvarco", name: "Río Varvarco", lengthKm: 100 }];
    data.subbasins = [
      { _id: "neuquen", name: "Neuquén", kind: "river" },
      { _id: "endorheic", name: null, kind: "endorheic" },
    ];
    data.streams = [
      {
        _id: "arroyo-blanco-1",
        name: "Arroyo Blanco",
        lengthKm: 12,
        bbox,
        subbasin: "neuquen",
      },
      {
        _id: "arroyo-blanco-2",
        name: "Arroyo Blanco",
        lengthKm: 150,
        bbox,
        subbasin: "endorheic",
      },
      {
        _id: "arroyo-blanco-3",
        name: "Arroyo Blanco",
        lengthKm: 5,
        bbox,
        subbasin: null,
      },
    ];
    const hits = await searchNames("nqn", "arroyo blanco");
    expect(hits.map((h) => `${h.kind}:${h.id}`)).toEqual([
      "stream:arroyo-blanco-2",
      "river:varvarco",
      "stream:arroyo-blanco-1",
      "stream:arroyo-blanco-3",
    ]);
    expect(hits[0]).toEqual({
      kind: "stream",
      id: "arroyo-blanco-2",
      name: "Arroyo Blanco",
      bbox,
      subbasin: { id: "endorheic", name: null, kind: "endorheic" },
    });
    expect(hits[2]).toMatchObject({
      subbasin: { id: "neuquen", name: "Neuquén", kind: "river" },
    });
    expect(hits[3]).toMatchObject({ subbasin: null });
  });
});
