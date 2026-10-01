import { describe, expect, it } from "vitest";
import {
  parseReachId,
  parseRiverId,
  parseSearchQuery,
  searchPattern,
  SEARCH_MAX_LENGTH,
} from "@/lib/data/params";

describe("parseRiverId", () => {
  it("accepts slugs and rejects anything else", () => {
    expect(parseRiverId("collon-cura")).toBe("collon-cura");
    for (const bad of ["", "Negro", "a b", "a/b", "x".repeat(65), "$where"])
      expect(parseRiverId(bad)).toBeNull();
  });
});

describe("parseReachId", () => {
  it("accepts positive integers only", () => {
    expect(parseReachId("61523537")).toBe(61523537);
    for (const bad of [
      "0",
      "-1",
      "1.5",
      "1e3",
      "abc",
      "",
      "012",
      "99999999999",
    ])
      expect(parseReachId(bad)).toBeNull();
  });
});

describe("parseSearchQuery", () => {
  it("normalizes and bounds the query", () => {
    expect(parseSearchQuery("  Neuquén ")).toBe("neuquen");
    expect(parseSearchQuery("   ")).toBeNull();
    expect(parseSearchQuery(null)).toBeNull();
    expect(parseSearchQuery("x".repeat(SEARCH_MAX_LENGTH + 1))).toBeNull();
  });
});

describe("searchPattern", () => {
  it("matches the start of any word", () => {
    const p = searchPattern("cura");
    expect(p.test("rio collon cura")).toBe(true);
    expect(p.test("rio curacura")).toBe(true);
    expect(p.test("rio mercurai")).toBe(false);
  });
  it("escapes regex syntax", () => {
    expect(searchPattern("a.*").test("rio negro")).toBe(false);
    expect(searchPattern("(").test("rio (")).toBe(true);
  });
});
