import { describe, expect, it } from "vitest";
import { hiddenSubbasinsFilter } from "@/lib/map/style";
import { useMapStore } from "@/lib/store";

describe("hiding the rest of the basin", () => {
  it("hides nothing until sub-basins are isolated", () => {
    expect(hiddenSubbasinsFilter(null)).toEqual(["boolean", false]);
    expect(hiddenSubbasinsFilter(["limay"])).toEqual([
      "!",
      ["in", ["get", "id"], ["literal", ["limay"]]],
    ]);
  });

  it("is cleared by a new selection and by leaving the sub-basin view", () => {
    const s = useMapStore.getState;
    s().select({ kind: "subbasin", id: "limay" });
    s().setIsolatedIds(["limay"]);
    s().select({ kind: "subbasin", id: "neuquen" });
    expect(s().isolatedIds).toBeNull();

    s().setIsolatedIds(["neuquen"]);
    s().setViewMode("basin");
    expect(s().isolatedIds).toBeNull();
    expect(s().selection).toBeNull();
  });
});
