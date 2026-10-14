import { describe, expect, it } from "vitest";
import { toPicked, toPickedLine } from "../lib/map/picked";
import {
  DAM_LAYER_ID,
  DAM_WALL_LAYER_ID,
  IGN_DETAIL_LAYER_ID,
  IGN_LAKE_FILL_LAYER_ID,
  LAKE_HIT_LAYER_ID,
  LOCALITY_LAYER_ID,
  localityFilter,
} from "../lib/map/style";

describe("toPicked", () => {
  it("reads an IGN detail line: name and length, null when the tile has no length", () => {
    expect(
      toPicked(IGN_DETAIL_LAYER_ID, { name: "Arroyo Blanco", km: 2.4, id: 7 }),
    ).toEqual({ kind: "detail", name: "Arroyo Blanco", km: 2.4 });
    expect(toPicked(IGN_DETAIL_LAYER_ID, { km: 1 })).toEqual({
      kind: "detail",
      name: null,
      km: 1,
    });
    expect(toPicked(IGN_DETAIL_LAYER_ID, { name: "X" })).toBeNull();
  });

  it("treats a missing or blank name as unnamed (tippecanoe drops null attributes)", () => {
    expect(toPicked(DAM_LAYER_ID, {})).toEqual({ kind: "dam", name: null });
    expect(toPicked(DAM_WALL_LAYER_ID, { name: "  " })).toEqual({
      kind: "wall",
      name: null,
    });
  });

  it("says where a lake's area comes from", () => {
    const props = {
      name: "Embalse Alicurá",
      kind: "reservoir",
      areaKm2: 53.4,
    };
    expect(toPicked(LAKE_HIT_LAYER_ID, props)).toEqual({
      kind: "water",
      name: "Embalse Alicurá",
      waterKind: "reservoir",
      areaKm2: 53.4,
      areaSource: "hydrolakes",
    });
    expect(toPicked(IGN_LAKE_FILL_LAYER_ID, props)).toMatchObject({
      areaSource: "ign",
    });
  });

  it("reads a locality: name and place class; null without either", () => {
    expect(
      toPicked(LOCALITY_LAYER_ID, { name: "Neuquén", place: "city", id: "1" }),
    ).toEqual({ kind: "locality", name: "Neuquén", place: "city" });
    expect(toPicked(LOCALITY_LAYER_ID, { place: "town" })).toBeNull();
    expect(
      toPicked(LOCALITY_LAYER_ID, { name: "X", place: "hamlet" }),
    ).toBeNull();
  });

  it("rejects a water body of an unknown kind and any other layer", () => {
    expect(toPicked(LAKE_HIT_LAYER_ID, { kind: "swamp" })).toBeNull();
    expect(toPicked("reaches-perennial", { name: "x" })).toBeNull();
  });
});

describe("lake source and line pieces (R3.7)", () => {
  it("reads who drew a lake from its source property, where the layer mixes sources", () => {
    const props = { kind: "lake", areaKm2: 5577.5, name: "Mar Chiquita" };
    expect(
      toPicked(LAKE_HIT_LAYER_ID, { ...props, source: "aprhi" }),
    ).toMatchObject({ areaSource: "aprhi" });
    expect(
      toPicked(LAKE_HIT_LAYER_ID, { ...props, source: "ign" }),
    ).toMatchObject({ areaSource: "ign" });
    expect(
      toPicked(LAKE_HIT_LAYER_ID, { ...props, source: "other" }),
    ).toMatchObject({ areaSource: "hydrolakes" });
  });

  it("reads a line piece no reach matched from its tile properties", () => {
    expect(
      toPickedLine({
        piece: "a-12-0",
        src: "aprhi",
        km: 1.25,
        name: "Arroyo Seco",
        review: 1,
      }),
    ).toEqual({
      kind: "line",
      name: "Arroyo Seco",
      source: "aprhi",
      km: 1.25,
      review: true,
    });
    expect(toPickedLine({ piece: "i-3-1", src: "ign", km: 0.4 })).toEqual({
      kind: "line",
      name: null,
      source: "ign",
      km: 0.4,
      review: false,
    });
  });

  it("reads a fill piece: HydroRIVERS only as fill, with its river and form", () => {
    const fill = {
      piece: "fill:hr:quinto:1",
      src: "hydrorivers",
      km: 12.3,
      river: "quinto",
      form: "route",
      fill: 1,
    };
    expect(toPickedLine(fill)).toEqual({
      kind: "line",
      name: null,
      source: "hydrorivers",
      km: 12.3,
      review: false,
      river: "quinto",
      form: "route",
    });
    expect(toPickedLine({ ...fill, fill: undefined })).toBeNull();
  });

  it("is null for a reach (no piece) or a piece without source or length", () => {
    expect(toPickedLine({ strahler: 3, network: "connected" })).toBeNull();
    expect(toPickedLine({ piece: "x", src: "osm", km: 1 })).toBeNull();
    expect(toPickedLine({ piece: "x", src: "ign" })).toBeNull();
  });
});

describe("localityFilter", () => {
  it("shows every locality, or none when toggled off", () => {
    expect(localityFilter(true)).toEqual(["literal", true]);
    expect(localityFilter(false)).toEqual(["boolean", false]);
  });
});
