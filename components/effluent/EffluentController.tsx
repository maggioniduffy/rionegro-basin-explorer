"use client";

import type { FilterSpecification } from "@maplibre/maplibre-gl-style-spec";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { useEffect } from "react";
import { useRegion } from "@/components/RegionProvider";
import { hasEffluent, reachStatus } from "@/lib/effluent/overlay";
import { getEffluentRegion } from "@/lib/effluent/registry";
import { useEffluentRun } from "@/lib/effluent/use-run";
import { DAM_WALL_LAYER_ID, reachWidth } from "@/lib/map/style";
import { useMapStore } from "@/lib/store";
import { EFFLUENT_COLORS } from "@/lib/theme-tokens";

export const PLUME_LAYER_ID = "effluent-plume";
export const OUTFALL_SOURCE_ID = "effluent-outfall";
export const OUTFALL_LAYER_ID = "effluent-outfall";

const NO_REACHES: FilterSpecification = ["boolean", false];

type Position = [number, number];

/** Both ends of every line piece the tiles hold for a reach (a reach may be split by tile edges). */
function endpoints(map: MapLibreMap, id: number): Position[] {
  const out: Position[] = [];
  const features = map.querySourceFeatures("rivers", {
    sourceLayer: "reaches",
    filter: ["==", ["id"], id],
  });
  for (const f of features) {
    const g = f.geometry;
    const lines =
      g.type === "LineString"
        ? [g.coordinates]
        : g.type === "MultiLineString"
          ? g.coordinates
          : [];
    for (const line of lines) {
      const first = line[0];
      const last = line[line.length - 1];
      if (first && last) out.push([first[0]!, first[1]!], [last[0]!, last[1]!]);
    }
  }
  return out;
}

const EPS_DEG = 1e-4;
const near = (a: Position, b: Position) =>
  Math.abs(a[0] - b[0]) < EPS_DEG && Math.abs(a[1] - b[1]) < EPS_DEG;

/**
 * Where the outfall reach starts: its end farthest from the reach it flows into. The line
 * direction in the tiles is not assumed. Ends that meet another piece of the same reach are tile
 * edges, not ends. null until the tiles of both reaches are loaded (or at the river mouth).
 */
function outfallPoint(
  map: MapLibreMap,
  reach: number,
  nextDown: number,
): Position | null {
  if (nextDown === 0) return null;
  const down = endpoints(map, nextDown);
  const ends = endpoints(map, reach).filter(
    (p, i, all) => !all.some((q, j) => j !== i && near(p, q)),
  );
  if (down.length === 0 || ends.length === 0) return null;
  const gap = (p: Position) =>
    Math.min(...down.map((q) => Math.hypot(p[0] - q[0], p[1] - q[1])));
  return ends.reduce((a, b) => (gap(b) > gap(a) ? b : a));
}

/**
 * Owns the effluent overlay on the main map: the plume (the simulated path's reaches, coloured
 * by whether a threshold is exceeded) as a layer over the reach tiles, and the outfall marker.
 * Renders nothing. A region without an effluent net attaches nothing.
 */
export function EffluentController({ map }: { map: MapLibreMap | null }) {
  const region = useRegion();
  const run = useEffluentRun();
  const theme = useMapStore((s) => s.theme);
  const reach = useMapStore((s) => s.effluent?.reach ?? null);

  useEffect(() => {
    if (!map || !hasEffluent(region)) return;
    map.addSource(OUTFALL_SOURCE_ID, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    // Above the reach classes (and so the dimmed lines), below the dams and labels.
    map.addLayer(
      {
        id: PLUME_LAYER_ID,
        type: "line",
        source: "rivers",
        "source-layer": "reaches",
        filter: NO_REACHES,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": EFFLUENT_COLORS.dark.within,
          "line-opacity": 0.95,
          "line-width": reachWidth(1, 1.5),
        },
      },
      map.getLayer(DAM_WALL_LAYER_ID) ? DAM_WALL_LAYER_ID : undefined,
    );
    map.addLayer({
      id: OUTFALL_LAYER_ID,
      type: "circle",
      source: OUTFALL_SOURCE_ID,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 4, 12, 7],
        "circle-color": EFFLUENT_COLORS.dark.outfall,
        "circle-stroke-color": EFFLUENT_COLORS.dark.exceeds,
        "circle-stroke-width": 2,
      },
    });
    return () => {
      try {
        for (const id of [OUTFALL_LAYER_ID, PLUME_LAYER_ID])
          if (map.getLayer(id)) map.removeLayer(id);
        if (map.getSource(OUTFALL_SOURCE_ID))
          map.removeSource(OUTFALL_SOURCE_ID);
      } catch {
        // The map was already removed.
      }
    };
  }, [map, region]);

  // The plume follows the run; nothing is drawn unless the run is ok (no stale or mean plume).
  useEffect(() => {
    if (!map || !hasEffluent(region) || !map.getLayer(PLUME_LAYER_ID)) return;
    const colors = EFFLUENT_COLORS[theme];
    if (run.status !== "ok") {
      map.setFilter(PLUME_LAYER_ID, NO_REACHES);
      return;
    }
    const status = reachStatus(run.result, run.inputs.thresholds);
    const exceeds = [...status]
      .filter(([, s]) => s === "exceeds")
      .map(([id]) => id);
    map.setFilter(PLUME_LAYER_ID, [
      "in",
      ["id"],
      ["literal", [...status.keys()]],
    ]);
    map.setPaintProperty(
      PLUME_LAYER_ID,
      "line-color",
      exceeds.length > 0
        ? ["match", ["id"], exceeds, colors.exceeds, colors.within]
        : colors.within,
    );
  }, [map, region, run, theme]);

  // The marker needs the reach's tiles; try again as sources load until it is placed.
  useEffect(() => {
    if (!map || !hasEffluent(region) || !map.getLayer(OUTFALL_LAYER_ID)) return;
    const source = map.getSource<GeoJSONSource>(OUTFALL_SOURCE_ID);
    if (!source) return;
    const colors = EFFLUENT_COLORS[theme];
    map.setPaintProperty(OUTFALL_LAYER_ID, "circle-color", colors.outfall);
    map.setPaintProperty(
      OUTFALL_LAYER_ID,
      "circle-stroke-color",
      colors.exceeds,
    );
    const set = (point: Position | null) =>
      source.setData({
        type: "FeatureCollection",
        features: point
          ? [
              {
                type: "Feature",
                properties: {},
                geometry: { type: "Point", coordinates: point },
              },
            ]
          : [],
      });
    set(null);
    const nextDown = reach
      ? getEffluentRegion(region)?.net.reaches.find((r) => r.id === reach)
          ?.nextDown
      : undefined;
    if (reach === null || nextDown === undefined) return;
    let placed = false;
    const place = () => {
      if (placed) return;
      const point = outfallPoint(map, reach, nextDown);
      if (!point) return;
      placed = true;
      set(point);
      map.off("sourcedata", place);
    };
    place();
    if (!placed) map.on("sourcedata", place);
    return () => {
      map.off("sourcedata", place);
    };
  }, [map, region, reach, theme]);

  return null;
}
