import { describe, expect, it } from "vitest";
import { selectIds } from "../scripts/lib/flow-water-select";

const entries = [
  { id: "limay-001", river: "limay", index: 1 },
  { id: "limay-002", river: "limay", index: 2 },
  { id: "neuquen-001", river: "neuquen", index: 1 },
];

describe("flow-water plan", () => {
  it("keeps index order while combining ranges and rivers", () => {
    expect(selectIds(entries, "limay-002", "neuquen")).toEqual([
      "limay-002",
      "neuquen-001",
    ]);
  });
});
