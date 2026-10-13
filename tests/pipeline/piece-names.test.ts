import { describe, expect, it } from "vitest";
import {
  type AliasesFile,
  pieceDisplayName,
  rawNameIndex,
  streamAliases,
} from "../../pipeline/lib/piece-names";

const aliases: AliasesFile = {
  names: {
    "rio tercero": {
      display: "Río Tercero",
      raw: ["R. Tercero (Ctalamochita)", "Rio Tercero"],
      aliases: ["R. Tercero (Ctalamochita)", "Ctalamochita", "Río Tercero"],
    },
    "arroyo seco": { display: "Arroyo Seco", raw: ["A. Seco"], aliases: [] },
  },
};

describe("pieceDisplayName", () => {
  const index = rawNameIndex(aliases);

  it("shows the display name pipeline:line-names decided for an APRHI value", () => {
    expect(
      pieceDisplayName(
        { source: "aprhi", name: " R. Tercero  (Ctalamochita)" },
        index,
      ),
    ).toBe("Río Tercero");
    expect(pieceDisplayName({ source: "aprhi", name: "A. Seco" }, index)).toBe(
      "Arroyo Seco",
    );
  });

  it("blanks starred APRHI names and shows IGN names as written", () => {
    expect(
      pieceDisplayName({ source: "aprhi", name: "A. Seco*" }, index),
    ).toBeNull();
    expect(
      pieceDisplayName({ source: "ign", name: "Arroyo  Hondo" }, index),
    ).toBe("Arroyo Hondo");
    expect(pieceDisplayName({ source: "aprhi", name: "  " }, index)).toBeNull();
  });

  it("throws on a stale aliases.json and on an unknown source", () => {
    expect(() =>
      pieceDisplayName({ source: "aprhi", name: "A. Nuevo" }, index),
    ).toThrow(/re-run pipeline:line-names/);
    expect(() => pieceDisplayName({ source: "osm", name: "X" }, index)).toThrow(
      /unknown line source/,
    );
  });
});

describe("rawNameIndex", () => {
  it("throws when one raw value belongs to two names", () => {
    expect(() =>
      rawNameIndex({
        names: {
          a: { display: "A", raw: ["X"], aliases: [] },
          b: { display: "B", raw: ["X"], aliases: [] },
        },
      }),
    ).toThrow(/two names/);
  });
});

describe("streamAliases", () => {
  it("lists other names without the stream's own, and none for an unknown name", () => {
    expect(streamAliases("Río Tercero", aliases)).toEqual([
      "R. Tercero (Ctalamochita)",
      "Ctalamochita",
    ]);
    expect(streamAliases("Arroyo Hondo", aliases)).toEqual([]);
  });
});
