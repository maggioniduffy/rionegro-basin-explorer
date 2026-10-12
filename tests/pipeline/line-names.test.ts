import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  type NamesConfig,
  UnknownPrefixError,
  editDistance,
  findCorrection,
  ignMainName,
  ignParenthesized,
  looksDamaged,
  parseAprhiName,
} from "../../pipeline/lib/line-names";

const cfg = JSON.parse(
  readFileSync(
    new URL("../../regions/cba/names.config.json", import.meta.url),
    "utf8",
  ),
) as NamesConfig;

describe("parseAprhiName", () => {
  it("expands the abbreviation at the start", () => {
    expect(parseAprhiName("A. Biguá", cfg)).toMatchObject({
      display: "Arroyo Biguá",
      starred: false,
      rules: ["abbr:a"],
    });
    expect(parseAprhiName("R. Anizacate", cfg).display).toBe("Río Anizacate");
    expect(parseAprhiName("Cda. Busto", cfg).display).toBe("Cañada Busto");
    expect(parseAprhiName("C. del Manantial", cfg).display).toBe(
      "Cañada del Manantial",
    );
    expect(parseAprhiName("Q. El Calabozo", cfg).display).toBe(
      "Quebrada El Calabozo",
    );
  });

  it("collapses spaces and expands inside the name", () => {
    expect(parseAprhiName("A.  Canna  glauca", cfg).display).toBe(
      "Arroyo Canna glauca",
    );
    expect(parseAprhiName("Brazo R. Carnero", cfg).display).toBe(
      "Brazo Río Carnero",
    );
    expect(parseAprhiName("A. Q. del Rodeo", cfg).display).toBe(
      "Arroyo Quebrada del Rodeo",
    );
    expect(parseAprhiName("A. Cda de los Duendes (Seco)", cfg)).toMatchObject({
      display: "Arroyo Cañada de los Duendes",
      parenthesized: ["Seco"],
    });
  });

  it("expands an abbreviation glued to the next word", () => {
    expect(parseAprhiName("A.Yerutí", cfg).display).toBe("Arroyo Yerutí");
  });

  it("moves the parenthesized name to the aliases", () => {
    expect(parseAprhiName("R. Tercero (Ctalamochita)", cfg)).toMatchObject({
      raw: "R. Tercero (Ctalamochita)",
      display: "Río Tercero",
      parenthesized: ["Ctalamochita"],
    });
    expect(parseAprhiName("A. del Gato (Achiras)", cfg)).toMatchObject({
      display: "Arroyo del Gato",
      parenthesized: ["Achiras"],
    });
    expect(parseAprhiName("R. Junta (A. Santa Cruz)", cfg).parenthesized).toEqual([
      "Arroyo Santa Cruz",
    ]);
  });

  it("splits alternatives joined by o and drops a leading o", () => {
    expect(parseAprhiName("A. La Totorilla (o Suyataco)", cfg).parenthesized).toEqual(
      ["Suyataco"],
    );
    expect(
      parseAprhiName("A. Suncho Huaico ( Dulce o Santa María)", cfg).parenthesized,
    ).toEqual(["Dulce", "Santa María"]);
  });

  it("does not offer a qualifier as an alias", () => {
    expect(parseAprhiName("R. Quinto (brazo)", cfg)).toMatchObject({
      display: "Río Quinto",
      parenthesized: [],
      excluded: ["brazo"],
    });
  });

  it("blanks a name with a star and keeps the raw value", () => {
    for (const raw of ["A. Bola*", "A. Seco *", "A. Las Petacas* (Viuda Lopez*)"]) {
      expect(parseAprhiName(raw, cfg)).toMatchObject({
        starred: true,
        display: null,
        raw,
      });
    }
  });

  it("fixes the spelling of río", () => {
    expect(parseAprhiName("Rio Cuarto", cfg).display).toBe("Río Cuarto");
    expect(parseAprhiName("Rió Cuarto", cfg).display).toBe("Río Cuarto");
    expect(parseAprhiName("BY PASS RIO TERCERO", cfg)).toMatchObject({
      display: "BY PASS RÍO TERCERO",
      rules: ["fix:rio"],
    });
  });

  it("leaves a full name alone", () => {
    expect(parseAprhiName("Vertiente La Cañada", cfg).display).toBe(
      "Vertiente La Cañada",
    );
    expect(parseAprhiName("Bajo de las Junturas", cfg).display).toBe(
      "Bajo de las Junturas",
    );
    expect(parseAprhiName("Río Primero", cfg).rules).toEqual([]);
  });

  it("stops on an unknown prefix", () => {
    expect(() => parseAprhiName("Z. Algo", cfg)).toThrow(UnknownPrefixError);
    expect(() => parseAprhiName("Laguna Larga", cfg)).toThrow(
      /unknown name prefix "Laguna"/,
    );
  });

  it("lists a dotted word that is not in the table", () => {
    expect(parseAprhiName("A. Pto. Viejo", cfg)).toMatchObject({
      display: "Arroyo Pto. Viejo",
      unexpanded: ["Pto."],
    });
  });

  it("returns nothing for an empty value and flags unbalanced parentheses", () => {
    expect(parseAprhiName("  ", cfg)).toMatchObject({ raw: null, display: null });
    expect(parseAprhiName(null, cfg).starred).toBe(false);
    expect(parseAprhiName("A. El Cimarr(n", cfg).unbalanced).toBe(true);
  });
});

describe("editDistance", () => {
  it("counts inserts, deletes and replacements", () => {
    expect(editDistance("arroyo anambn", "arroyo anambe")).toBe(1);
    expect(editDistance("las peaas", "las penas")).toBe(1);
    expect(editDistance("abc", "")).toBe(3);
    expect(editDistance("seco", "seco")).toBe(0);
    expect(editDistance("kitten", "sitting")).toBe(3);
  });
});

describe("IGN names", () => {
  it("splits the main and parenthesized parts", () => {
    expect(ignMainName("Río Tercero (Ctalamochita)")).toBe("Río Tercero");
    expect(ignParenthesized("Río Tercero (Ctalamochita)")).toEqual(["Ctalamochita"]);
    expect(ignParenthesized("Arroyo X (o El Manso)")).toEqual(["El Manso"]);
    expect(ignParenthesized("Arroyo X")).toEqual([]);
  });
});

describe("findCorrection", () => {
  const conf = { aliasMinShare: 0.5, maxEditDistance: 2 };
  const none = new Set<string>();

  it("takes the IGN spelling of a damaged name that runs along it", () => {
    expect(
      findCorrection("Arroyo Anambn", [{ name: "Arroyo Anambé", share: 0.9 }], none, conf),
    ).toEqual({ name: "Arroyo Anambé", share: 0.9, distance: 1 });
  });

  it("ignores IGN names that run along less than the threshold", () => {
    expect(
      findCorrection("Arroyo Anambn", [{ name: "Arroyo Anambé", share: 0.4 }], none, conf),
    ).toBeNull();
  });

  it("does nothing when the spelling already agrees with an IGN name", () => {
    expect(
      findCorrection(
        "Arroyo Seco",
        [
          { name: "Arroyo Seco", share: 0.8 },
          { name: "Arroyo Sauce", share: 0.7 },
        ],
        none,
        conf,
      ),
    ).toBeNull();
  });

  it("does not merge with the name of another APRHI line", () => {
    expect(
      findCorrection(
        "Arroyo Seco",
        [{ name: "Arroyo Sauce", share: 0.9 }],
        new Set(["arroyo sauce"]),
        conf,
      ),
    ).toBeNull();
  });

  it("needs the same number of words and a distance within the limit", () => {
    expect(
      findCorrection("Arroyo Anambn", [{ name: "Arroyo Anambé Grande", share: 0.9 }], none, conf),
    ).toBeNull();
    expect(
      findCorrection("Arroyo Abcdef", [{ name: "Arroyo Abxyzf", share: 0.9 }], none, conf),
    ).toBeNull();
  });

  it("picks the smallest distance, then the largest share", () => {
    expect(
      findCorrection(
        "Arroyo Aaaa",
        [
          { name: "Arroyo Abbb", share: 0.9 },
          { name: "Arroyo Aaab", share: 0.6 },
          { name: "Arroyo Aaac", share: 0.7 },
        ],
        none,
        conf,
      ),
    ).toMatchObject({ name: "Arroyo Aaac", distance: 1 });
  });
});

describe("looksDamaged", () => {
  it("flags the signs of lost characters", () => {
    expect(looksDamaged("Arroyo El ParedPn")).toBe(true);
    expect(looksDamaged("Arroyo del CastaMo")).toBe(true);
    expect(looksDamaged("Arroyo El Cimarr(n")).toBe(true);
    expect(looksDamaged("Arroyo del Gato")).toBe(false);
  });
});
