import { describe, expect, it } from "vitest";
import {
  featureFilter,
  type FilterSpecification,
  validateStyleMin,
} from "@maplibre/maplibre-gl-style-spec";
import {
  buildMinimapStyle,
  MINIMAP_MIN_STRAHLER,
  MINIMAP_VIEW_MAX_SHARE,
  MINIMAP_VIEW_MIN_SHARE,
  MINIMAP_VIEW_SOURCE,
  minimapCamera,
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

describe("minimapCamera", () => {
  const basin: [number, number, number, number] = [
    -71.96, -41.5, -62.75, -36.18,
  ];
  const size: [number, number] = [288, 176];
  const overview = minimapCamera({
    view: [-69, -40, -65, -38],
    basin,
    size,
  });
  const mercX = (lng: number) => (lng + 180) / 360;
  const mercY = (lat: number) =>
    (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
  // Share of the minimap a view box spans at a camera, in its tighter dimension.
  const share = (view: number[], zoom: number) =>
    Math.max(
      ((mercX(view[2]!) - mercX(view[0]!)) * 512 * 2 ** zoom) / size[0],
      ((mercY(view[1]!) - mercY(view[3]!)) * 512 * 2 ** zoom) / size[1],
    );

  it("shows the whole basin while the view fits there", () => {
    const view = [-70, -40.5, -66, -38.5] as [number, number, number, number];
    const cam = minimapCamera({ view, basin, size });
    expect(cam.zoom).toBeCloseTo(overview.zoom);
    const scale = 512 * 2 ** cam.zoom;
    const [cx, cy] = [mercX(cam.center[0]), mercY(cam.center[1])];
    expect(cx - size[0] / 2 / scale).toBeLessThanOrEqual(mercX(basin[0]));
    expect(cx + size[0] / 2 / scale).toBeGreaterThanOrEqual(mercX(basin[2]));
    expect(cy - size[1] / 2 / scale).toBeLessThanOrEqual(mercY(basin[3]));
    expect(cy + size[1] / 2 / scale).toBeGreaterThanOrEqual(mercY(basin[1]));
  });

  it("follows a close-in view so the box stays readable", () => {
    const view = [-70.02, -40.01, -70, -40] as [number, number, number, number];
    const cam = minimapCamera({ view, basin, size });
    expect(cam.zoom).toBeGreaterThan(overview.zoom);
    expect(share(view, cam.zoom)).toBeGreaterThanOrEqual(
      MINIMAP_VIEW_MIN_SHARE - 1e-9,
    );
    expect(cam.center[0]).toBeCloseTo(-70.01, 2);
    expect(cam.center[1]).toBeCloseTo(-40.005, 2);
  });

  it("backs off when the view is wider than the basin", () => {
    const view = [-80, -48, -55, -30] as [number, number, number, number];
    const cam = minimapCamera({ view, basin, size });
    expect(cam.zoom).toBeLessThan(overview.zoom);
    expect(share(view, cam.zoom)).toBeLessThanOrEqual(
      MINIMAP_VIEW_MAX_SHARE + 1e-9,
    );
  });

  it("keeps a view at the basin's edge in sight", () => {
    const view = [-72.5, -42, -72.3, -41.9] as [number, number, number, number];
    const cam = minimapCamera({ view, basin, size });
    const half = size[0] / 2 / (512 * 2 ** cam.zoom);
    expect(mercX(cam.center[0]) - half).toBeLessThanOrEqual(mercX(view[0]));
    expect(mercX(cam.center[0]) + half).toBeGreaterThanOrEqual(mercX(view[2]));
  });
});
