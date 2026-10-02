import { describe, expect, it } from "vitest";
import { snapshotFileName, wrapText } from "../lib/map/snapshot";

describe("snapshotFileName", () => {
  it("uses the local date, zero-padded", () => {
    expect(snapshotFileName(new Date(2026, 0, 5, 23, 59))).toBe(
      "rio-negro-basin-2026-01-05.png",
    );
  });
});

describe("wrapText", () => {
  // One unit per character, so widths are easy to read.
  const measure = (s: string) => s.length;

  it("breaks between words at the width", () => {
    expect(wrapText("aa bb cc dd", 5, measure)).toEqual(["aa bb", "cc dd"]);
  });

  it("gives an over-long word its own line", () => {
    expect(wrapText("a verylongword b", 5, measure)).toEqual([
      "a",
      "verylongword",
      "b",
    ]);
  });

  it("collapses whitespace and returns nothing for empty text", () => {
    expect(wrapText("  a \n b ", 10, measure)).toEqual(["a b"]);
    expect(wrapText("   ", 10, measure)).toEqual([]);
  });
});
