import type { AnyBulkWriteOperation, Document, Filter } from "mongodb";
import type { z } from "zod";
import type { IgnName, IgnNameDoc, River, RiverDoc } from "../lib/data/schemas";
import { searchTerms } from "../lib/data/search";

/** Parse and validate NDJSON; errors name the line so the pipeline output can be fixed. */
export function parseNdjson<T>(text: string, schema: z.ZodType<T>): T[] {
  return text
    .split("\n")
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => line.trim() !== "")
    .map(({ line, n }) => {
      const result = schema.safeParse(JSON.parse(line));
      if (!result.success) {
        throw new Error(`line ${n}: ${result.error.message}`);
      }
      return result.data;
    });
}

export function toRiverDoc(river: River): RiverDoc {
  return {
    ...river,
    searchTerms: searchTerms([river.name, river.shortName, ...river.aliases]),
  };
}

export function toIgnNameDoc(name: IgnName): IgnNameDoc {
  return { ...name, searchTerms: searchTerms([name.name]) };
}

/**
 * Whole-document upserts keyed on _id. Replacing a document with an identical one is
 * not a modification, so a second run reports 0 upserted and 0 modified.
 */
export function upsertOps<T extends Document & { _id: unknown }>(
  docs: T[],
): AnyBulkWriteOperation<T>[] {
  return docs.map((doc) => ({
    replaceOne: {
      filter: { _id: doc._id } as Filter<T>,
      replacement: doc,
      upsert: true,
    },
  }));
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}
