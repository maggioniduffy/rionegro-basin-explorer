import { describe, expect, it } from "vitest";
import {
  atLeastHalf,
  nearestSnap,
  SHEET_PEEK_PX,
  sheetHeights,
} from "../lib/sheet";

describe("sheetHeights", () => {
  it("stops below the header and above the attribution", () => {
    expect(sheetHeights({ viewport: 800, top: 100, attribution: 40 })).toEqual({
      peek: SHEET_PEEK_PX,
      half: 400,
      full: 660,
    });
  });

  it("never goes below the peek height on a tiny window", () => {
    const h = sheetHeights({ viewport: 120, top: 100, attribution: 40 });
    expect(h.full).toBe(SHEET_PEEK_PX);
    expect(h.half).toBe(SHEET_PEEK_PX);
  });

  it("keeps half within full on a short, wide window", () => {
    const h = sheetHeights({ viewport: 300, top: 120, attribution: 60 });
    expect(h.half).toBeLessThanOrEqual(h.full);
  });
});

describe("nearestSnap", () => {
  const heights = { peek: 76, half: 400, full: 660 };

  it("picks the closest resting height", () => {
    expect(nearestSnap(100, heights)).toBe("peek");
    expect(nearestSnap(350, heights)).toBe("half");
    expect(nearestSnap(600, heights)).toBe("full");
  });
});

describe("atLeastHalf", () => {
  it("opens a peeking sheet to half and leaves a taller one alone", () => {
    expect(atLeastHalf("peek")).toBe("half");
    expect(atLeastHalf("half")).toBe("half");
    expect(atLeastHalf("full")).toBe("full");
  });
});
