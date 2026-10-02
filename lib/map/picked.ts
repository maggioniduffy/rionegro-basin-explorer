import {
  DAM_LAYER_ID,
  DAM_WALL_LAYER_ID,
  IGN_DETAIL_LAYER_ID,
  IGN_LAKE_FILL_LAYER_ID,
  LAKE_HIT_LAYER_ID,
  LOCALITY_LAYER_ID,
} from "./style";

/** What the lake layers call a water body (pipeline:ign-layers). */
export const WATER_KINDS = [
  "lake",
  "reservoir",
  "controlled-lake",
  "waterbody",
] as const;
export type WaterKind = (typeof WATER_KINDS)[number];

/** OSM place classes the localities layer carries (pipeline:localities). */
export const PLACE_KINDS = ["city", "town", "village"] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];

/**
 * A map feature that is not a HydroRIVERS reach: it has no API document, so the panel
 * reads what the tile carries. Names are IGN's (or HydroLAKES' where IGN has none).
 */
export type Picked =
  | { kind: "detail"; name: string | null; km: number }
  | {
      kind: "water";
      name: string | null;
      waterKind: WaterKind;
      areaKm2: number | null;
      /** Where the area comes from: HydroLAKES polygons, or IGN for the extra lakes. */
      areaSource: "hydrolakes" | "ign";
    }
  | { kind: "dam" | "wall"; name: string | null }
  | { kind: "locality"; name: string; place: PlaceKind };

/** Layers a click can pick, in the order the map checks them. */
export const PICKABLE_LAYER_IDS = [
  LOCALITY_LAYER_ID,
  DAM_LAYER_ID,
  DAM_WALL_LAYER_ID,
  IGN_DETAIL_LAYER_ID,
  LAKE_HIT_LAYER_ID,
  IGN_LAKE_FILL_LAYER_ID,
] as const;

const text = (v: unknown) =>
  typeof v === "string" && v.trim() !== "" ? v : null;
const positive = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * The panel content for a rendered feature of `layerId`; null for any other layer.
 * tippecanoe omits null attributes, so a missing `name` is an unnamed feature.
 */
export function toPicked(
  layerId: string,
  props: Record<string, unknown>,
): Picked | null {
  const name = text(props.name);
  switch (layerId) {
    case LOCALITY_LAYER_ID: {
      const place = PLACE_KINDS.find((k) => k === props.place);
      return name && place ? { kind: "locality", name, place } : null;
    }
    case DAM_LAYER_ID:
      return { kind: "dam", name };
    case DAM_WALL_LAYER_ID:
      return { kind: "wall", name };
    case IGN_DETAIL_LAYER_ID: {
      const km = positive(props.km);
      return km === null ? null : { kind: "detail", name, km };
    }
    case LAKE_HIT_LAYER_ID:
    case IGN_LAKE_FILL_LAYER_ID: {
      const waterKind = WATER_KINDS.find((k) => k === props.kind);
      if (!waterKind) return null;
      return {
        kind: "water",
        name,
        waterKind,
        areaKm2: positive(props.areaKm2),
        areaSource: layerId === LAKE_HIT_LAYER_ID ? "hydrolakes" : "ign",
      };
    }
    default:
      return null;
  }
}
