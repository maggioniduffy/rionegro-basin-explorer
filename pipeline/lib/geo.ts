/**
 * SQL snippets for DuckDB spatial on EPSG:4326 geometries stored lon/lat (x/y).
 *
 * ST_Area_Spheroid assumes [lat, lon] axis order, so the geometry is flipped first;
 * without the flip a 1°×1° cell at 41°S comes out 39% too small (checked 2026-09-30).
 * The equal-area projection gives an independent second figure.
 */
export const areaSpheroidKm2 = (g: string) =>
  `(ST_Area_Spheroid(ST_FlipCoordinates(${g})) / 1e6)`;

/** South America Albers Equal Area Conic. */
export const areaAlbersKm2 = (g: string) =>
  `(ST_Area(ST_Transform(${g}, 'EPSG:4326', 'ESRI:102033', always_xy := true)) / 1e6)`;

export const lengthSpheroidKm = (g: string) =>
  `(ST_Length_Spheroid(ST_FlipCoordinates(${g})) / 1e3)`;

export const envelope = (b: {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
}) => `ST_MakeEnvelope(${b.xmin}, ${b.ymin}, ${b.xmax}, ${b.ymax})`;

/** Relative difference of `a` from `b`, in percent. */
export const pctDiff = (a: number, b: number) => ((a - b) / b) * 100;
