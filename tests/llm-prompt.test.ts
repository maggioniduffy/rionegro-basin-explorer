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

  it("contains no numbers of three or more digits (no areas or lengths)", () => {
    expect(prompt).not.toMatch(/\d{3,}/);
  });

  it("leaves streams out and names the language", () => {
    const stream = docs.streams[0]!;
    expect(prompt).not.toContain(stream.name);
    expect(buildSystemPrompt("es", catalog)).toContain("Spanish");
    expect(prompt).toContain("English");
  });
});
