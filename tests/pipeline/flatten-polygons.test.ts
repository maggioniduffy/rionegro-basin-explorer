import { describe, expect, it } from "vitest";
import { flattenPolygons } from "../../pipeline/lib/flatten-polygons";

const square = [
  [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 0],
  ],
];

describe("flattenPolygons", () => {
  it("keeps a Polygon or MultiPolygon as it is", () => {
    const p = { type: "Polygon", coordinates: square };
    expect(flattenPolygons(p)).toBe(p);
    const m = { type: "MultiPolygon", coordinates: [square] };
    expect(flattenPolygons(m)).toBe(m);
  });

  it("gathers the polygons of nested collections into one MultiPolygon, dropping lines", () => {
    expect(
      flattenPolygons({
        type: "GeometryCollection",
        geometries: [
          {
            type: "GeometryCollection",
            geometries: [
              { type: "MultiPolygon", coordinates: [square, square] },
              {
                type: "LineString",
                coordinates: [
                  [0, 0],
                  [1, 1],
                ],
              },
            ],
          },
          { type: "Polygon", coordinates: square },
        ],
      }),
    ).toEqual({ type: "MultiPolygon", coordinates: [square, square, square] });
  });

  it("is null for a collection with no polygon", () => {
    expect(
      flattenPolygons({ type: "GeometryCollection", geometries: [] }),
    ).toBeNull();
  });
});
