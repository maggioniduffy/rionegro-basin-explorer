import { describe, expect, it } from "vitest";
import en from "../messages/en.json";
import es from "../messages/es.json";

/** Flatten a nested messages object into [dotted.path, value] pairs. */
function leaves(value: unknown, prefix = ""): [string, unknown][] {
  if (typeof value !== "object" || value === null) return [[prefix, value]];
  return Object.entries(value).flatMap(([key, child]) =>
    leaves(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe("messages", () => {
  it("en and es define the same keys", () => {
    const keys = (m: object) =>
      leaves(m)
        .map(([path]) => path)
        .sort();
    expect(keys(es)).toEqual(keys(en));
  });

  it.each([
    ["en", en],
    ["es", es],
  ])("%s has no empty strings", (_, messages) => {
    const empty = leaves(messages)
      .filter(([, v]) => typeof v !== "string" || v.trim() === "")
      .map(([path]) => path);
    expect(empty).toEqual([]);
  });
});
