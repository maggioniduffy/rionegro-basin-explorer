import { describe, expect, it } from "vitest";
import { idsHash } from "../../pipeline/lib/subset";

describe("idsHash", () => {
  it("ignores order", () => {
    expect(idsHash([3, 1, 2])).toBe(idsHash([1, 2, 3]));
  });

  it("sorts numerically, not as strings", () => {
    // String sort would put 10 before 9 and collide differently.
    expect(idsHash([9, 10])).toBe(idsHash([10, 9]));
  });

  it("changes when the selection changes", () => {
    expect(idsHash([1, 2, 3])).not.toBe(idsHash([1, 2, 4]));
  });
});
