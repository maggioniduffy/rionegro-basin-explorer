import { featureFilter } from "@maplibre/maplibre-gl-style-spec";
import { describe, expect, it } from "vitest";
import {
  hiddenSubbasinsFilter,
  selectedOutlineFilter,
  subbasinFillOpacity,
  subbasinFilter,
} from "@/lib/map/style";
import { useMapStore } from "@/lib/store";

describe("hiding the rest of the basin", () => {
  it("hides nothing until sub-basins are isolated", () => {
    expect(hiddenSubbasinsFilter(null)).toEqual(["boolean", false]);
  });

  // Own-area features as pipeline:subbasins writes them.
  const feature = (path: string[]) => ({
    type: 1 as const,
    properties: {
      id: path.at(-1),
      kind: "river",
      level: path.length - 1,
      path: `,${path.join(",")},`,
    },
    geometry: [],
  });
  const negro = feature(["negro"]);
  const limay = feature(["negro", "limay"]);
  const alumine = feature(["negro", "limay", "collon-cura", "alumine"]);
  const neuquen = feature(["negro", "neuquen"]);
  const matches = (filter: Parameters<typeof featureFilter>[0], f = negro) =>
    featureFilter(filter, "layers[0].filter").filter({ zoom: 8 }, f);

  it("isolates a whole subtree, descendants included", () => {
    const hidden = hiddenSubbasinsFilter(["limay"]);
    expect(matches(hidden, limay)).toBe(false);
    expect(matches(hidden, alumine)).toBe(false);
    expect(matches(hidden, neuquen)).toBe(true);
    expect(matches(hidden, negro)).toBe(true);
    const shown = subbasinFilter(false, ["collon-cura"]);
    expect(matches(shown, alumine)).toBe(true);
    expect(matches(shown, limay)).toBe(false);
  });

  it("does not confuse ids that share a prefix", () => {
    const leufu = feature(["negro", "limay", "picun-leufu"]);
    expect(matches(subbasinFilter(false, ["picun"]), leufu)).toBe(false);
  });

  it("tints the selected node's descendants and outlines only the node", () => {
    const sel = { kind: "subbasin" as const, id: "limay" };
    expect(subbasinFillOpacity("basin", sel)).toBe(0);
    expect(subbasinFillOpacity("subbasins", null)).toBe(0);
    expect(subbasinFillOpacity("subbasins", sel)).toEqual([
      "case",
      ["any", ["in", ",limay,", ["get", "path"]]],
      0.12,
      0,
    ]);
    const outline = selectedOutlineFilter(sel);
    expect(matches(outline, limay)).toBe(true);
    expect(matches(outline, alumine)).toBe(false);
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
