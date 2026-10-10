import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { CatalogDocs } from "@/lib/data/queries";

// `server-only` throws outside a react-server bundle; it is only a marker here.
vi.mock("server-only", () => ({}));

const { buildCatalog } = await import("@/lib/ask/catalog");
const { buildSystemPrompt } = await import("@/lib/llm/prompt");
const { METRICS, METRIC_IDS } = await import("@/lib/ask/metrics");

// The real seeded data: data/out is what `npm run seed` loads into Mongo.
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
const catalog = buildCatalog(docs);
const prompt = buildSystemPrompt("en", catalog);

describe("buildSystemPrompt", () => {
  it("no longer lists tributaries by upstream area", () => {
    expect(prompt).not.toContain("tributaries by upstream area");
    expect(prompt).not.toContain("largest first");
  });

  it("lists every metric id with the kinds it applies to", () => {
    for (const id of METRIC_IDS) {
      const kinds = Object.keys(METRICS[id].path).join(", ");
      expect(prompt).toContain(`${id} | applies to: ${kinds} | `);
    }
  });

  it("explains the seven actions and shows the compare example", () => {
    for (const action of [
      "select_river",
      "select_subbasin",
      "search",
      "compare",
      "rank",
      "fact",
      "unsupported",
    ])
      expect(prompt).toContain(`- ${action}:`);
    expect(prompt).toContain(
      '{"action":"compare","kind":"river","slug":null,"slugs":["caleufu","agrio"],"metric":"length","order":"max"',
    );
  });

  it("lists every river and sub-basin slug, and labels the endorheic one", () => {
    for (const r of docs.rivers) expect(prompt).toContain(`${r._id} | `);
    for (const s of docs.subbasins) expect(prompt).toContain(`${s._id} | `);
    expect(prompt).toContain("endorheic land / zonas endorreicas");
  });

  it("contains none of the seeded lengths or areas", () => {
    const values = new Set<number>();
    for (const doc of [...docs.rivers, ...docs.subbasins] as Array<{
      lengthKm?: number;
      areaKm2?: number;
      mouth?: { uplandKm2?: number };
    }>)
      for (const v of [doc.lengthKm, doc.areaKm2, doc.mouth?.uplandKm2])
        if (typeof v === "number" && v >= 100) values.add(v);
    expect(values.size).toBeGreaterThan(0);
    const bare = (text: string) => text.replace(/[\d.]*\d/g, (n) => ` ${n} `);
    const numbers = new Set(
      bare(prompt)
        .split(/\s+/)
        .filter((w) => /^[\d.]+$/.test(w)),
    );
    for (const v of values) {
      expect(numbers.has(String(Math.round(v)))).toBe(false);
      expect(numbers.has(v.toFixed(1))).toBe(false);
    }
  });

  it("describes the four filter types with examples", () => {
    for (const type of ["regime", "regulated", "within", "threshold"])
      expect(prompt).toContain(`- ${type}:`);
    expect(prompt).toContain('"filters":[{"type":"regime","value":"perennial"');
    expect(prompt).toContain(
      '{"type":"threshold","value":null,"slug":null,"metric":"length","op":"gt","number":100}',
    );
    expect(prompt).not.toMatch(
      /permanente más corto" -> \{"action":"unsupported"/,
    );
    expect(prompt).toContain('"filters":null');
  });

  it("leaves streams out and names the language", () => {
    const stream = docs.streams[0]!;
    expect(prompt).not.toContain(stream.name);
    expect(buildSystemPrompt("es", catalog)).toContain("Spanish");
    expect(prompt).toContain("English");
  });
});
