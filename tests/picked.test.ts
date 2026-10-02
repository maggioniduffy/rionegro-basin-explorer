import { describe, expect, it } from "vitest";
import { toPicked } from "../lib/map/picked";
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

describe("localityFilter", () => {
  it("shows every locality, or none when toggled off", () => {
    expect(localityFilter(true)).toEqual(["literal", true]);
    expect(localityFilter(false)).toEqual(["boolean", false]);
  });
});
