import { describe, expect, it } from "vitest";
import { DEFAULT_MEMORY_LIMIT, memoryLimit } from "../../pipeline/lib/duckdb";

describe("memoryLimit", () => {
  it("defaults when unset or blank", () => {
    expect(memoryLimit({})).toBe(DEFAULT_MEMORY_LIMIT);
    expect(memoryLimit({ PIPELINE_MEMORY_LIMIT: " " })).toBe(
      DEFAULT_MEMORY_LIMIT,
    );
  });
  it("accepts DuckDB sizes", () => {
    expect(memoryLimit({ PIPELINE_MEMORY_LIMIT: "12GB" })).toBe("12GB");
    expect(memoryLimit({ PIPELINE_MEMORY_LIMIT: "512MiB" })).toBe("512MiB");
  });
  it("rejects anything else", () => {
    expect(() => memoryLimit({ PIPELINE_MEMORY_LIMIT: "8" })).toThrow();
    expect(() =>
      memoryLimit({ PIPELINE_MEMORY_LIMIT: "8GB'; DROP" }),
    ).toThrow();
  });
});
