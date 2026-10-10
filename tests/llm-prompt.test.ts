import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { CatalogDocs } from "@/lib/data/queries";

// `server-only` throws outside a react-server bundle; it is only a marker here.
vi.mock("server-only", () => ({}));

const { buildCatalog } = await import("@/lib/ask/catalog");
const { buildSystemPrompt } = await import("@/lib/llm/prompt");

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
  it("orders Limay's tributaries by upstream area, largest first", () => {
    const line = prompt
      .split("\n")
      .find(
        (l, i, all) =>
          /^limay \|/.test(all[i - 1] ?? "") && l.includes("tributaries"),
      );
    expect(line).toBeDefined();
    const names = line!.split(": ")[1]!.split(", ");
    const area = new Map(docs.rivers.map((r) => [r.name, r.mouth.uplandKm2]));
    const expected = docs.rivers
      .filter((r) => r.flowsInto === "limay")
      .sort((a, b) => b.mouth.uplandKm2 - a.mouth.uplandKm2)
      .map((r) => r.name);
    expect(expected.length).toBeGreaterThan(1);
    expect(names).toEqual(expected);
    expect(area.size).toBeGreaterThan(0);
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
