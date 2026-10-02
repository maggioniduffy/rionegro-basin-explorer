import { describe, expect, it } from "vitest";
import {
  featureFilter,
  type FilterSpecification,
  validateStyleMin,
} from "@maplibre/maplibre-gl-style-spec";
import {
  buildMinimapStyle,
  MINIMAP_MIN_STRAHLER,
  MINIMAP_VIEW_SOURCE,
  viewPolygon,
} from "../lib/map/minimap";

describe("viewPolygon", () => {
  it("is empty without bounds", () => {
    expect(viewPolygon(null).features).toEqual([]);
  });

  it("closes the ring of the view box", () => {
    const [feature] = viewPolygon([-70, -41, -68, -39]).features;
    expect(feature?.geometry.coordinates).toEqual([
      [
        [-70, -41],
        [-68, -41],
        [-68, -39],
        [-70, -39],
        [-70, -41],
      ],
    ]);
  });
});

describe("buildMinimapStyle", () => {
  const style = buildMinimapStyle({
    origin: "http://localhost:3000",
    theme: "dark",
  });

  it("is a valid style", () => {
    expect(validateStyleMin(style)).toEqual([]);
  });

  it("uses no imagery: only the rivers tiles and the view box", () => {
    expect(Object.keys(style.sources).sort()).toEqual(
      ["rivers", MINIMAP_VIEW_SOURCE].sort(),
    );
  });

  it("keeps only the main stems", () => {
    const layer = style.layers.find((l) => l.id === "rivers");
    const filter = featureFilter(
      (layer as { filter: FilterSpecification }).filter,
      "layers[2].filter",
    );
    const at = (strahler: number) =>
      filter.filter({ zoom: 4 }, {
        type: 2,
        properties: { strahler },
        geometry: [],
      } as never);
    expect(at(MINIMAP_MIN_STRAHLER - 1)).toBe(false);
    expect(at(MINIMAP_MIN_STRAHLER)).toBe(true);
  });
});
