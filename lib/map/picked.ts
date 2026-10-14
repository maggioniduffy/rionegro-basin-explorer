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

/** Who drew a water body's outline (pipeline:lakes `source`; nqn tiles have none). */
export const WATER_SOURCES = ["aprhi", "ign", "hydrolakes"] as const;
export type WaterSource = (typeof WATER_SOURCES)[number];

/**
 * Who drew a displayed line piece (pipeline:lines `source`, tile property `src`);
 * `hydrorivers` only on a fill piece (R5, `fill` = 1).
 */
export const LINE_SOURCES = ["aprhi", "ign", "hydrorivers"] as const;
export type LineSource = (typeof LINE_SOURCES)[number];

/** How a fill piece was made (pipeline:river-lines `form`, tile property `form`). */
export const FILL_FORMS = ["chain", "route", "connector"] as const;
export type FillForm = (typeof FILL_FORMS)[number];

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
      /**
       * Who drew the outline (and so the area): the tile's `source` property where the lakes
       * layer mixes sources (cba: APRHI > IGN > HydroLAKES); otherwise the layer says it
       * (nqn: HydroLAKES polygons, IGN for the extra lakes).
       */
      areaSource: WaterSource;
    }
  /**
   * A displayed line piece matched to no HydroRIVERS reach (mapLines "pieces", R3.7): it has
   * no reach document, so only what the tile carries (name, source, length, review status).
   */
  | {
      kind: "line";
      name: string | null;
      source: LineSource;
      km: number;
      review: boolean;
      /** Slug of the approved river whose course the piece is on (cba, R5). */
      river?: string;
      /** Set on a fill piece (R5): how it was made. */
      form?: FillForm;
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
        areaSource:
          WATER_SOURCES.find((k) => k === props.source) ??
          (layerId === LAKE_HIT_LAYER_ID ? "hydrolakes" : "ign"),
      };
    }
    default:
      return null;
  }
}

/**
 * The panel content for a clicked line piece that no reach matched (no feature id): null
 * when the feature is not a piece (a nqn reach always has an id and no `piece`).
 */
export function toPickedLine(props: Record<string, unknown>): Picked | null {
  if (text(props.piece) === null) return null;
  const source = LINE_SOURCES.find((k) => k === props.src);
  const km = positive(props.km);
  const fill = Number(props.fill) === 1;
  if (!source || km === null) return null;
  if (source === "hydrorivers" && !fill) return null;
  const river = text(props.river);
  const form = fill ? FILL_FORMS.find((k) => k === props.form) : undefined;
  return {
    kind: "line",
    name: text(props.name),
    source,
    km,
    review: Number(props.review) === 1,
    ...(river ? { river } : {}),
    ...(form ? { form } : {}),
  };
}
