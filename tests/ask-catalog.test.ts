import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogDocs } from "@/lib/data/queries";

// `server-only` throws outside a react-server bundle; it is only a marker here.
vi.mock("server-only", () => ({}));

const getCatalogDocs = vi.fn<() => Promise<CatalogDocs>>();
vi.mock("@/lib/data/queries", () => ({ getCatalogDocs }));

const docs: CatalogDocs = {
  rivers: [
    {
      _id: "limay",
      name: "Río Limay",
      shortName: "Limay",
      aliases: [],
      flowsInto: "negro",
      lengthKm: 1,
      mouth: { uplandKm2: 1 },
    },
  ],
  subbasins: [],
  streams: [],
};

beforeEach(() => {
  vi.resetModules();
  getCatalogDocs.mockReset();
});

const load = async () => (await import("@/lib/ask/catalog")).getCatalog;

describe("getCatalog", () => {
  it("shares one load between callers and reloads after the TTL", async () => {
    getCatalogDocs.mockResolvedValue(docs);
    const getCatalog = await load();
    const { CATALOG_TTL_MS } = await import("@/lib/ask/catalog");
    const [a, b] = await Promise.all([getCatalog(0), getCatalog(1)]);
    expect(a).toBe(b);
    expect(getCatalogDocs).toHaveBeenCalledTimes(1);
    await getCatalog(CATALOG_TTL_MS + 1);
    expect(getCatalogDocs).toHaveBeenCalledTimes(2);
  });

  it("does not cache a failed load", async () => {
    getCatalogDocs
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValue(docs);
    const getCatalog = await load();
    await expect(getCatalog(0)).rejects.toThrow("timeout");
    const catalog = await getCatalog(1);
    expect(catalog.entries.map((e) => e.id)).toEqual(["limay"]);
  });
});
