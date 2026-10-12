import { describe, expect, it } from "vitest";
import {
  detailVerdict,
  exactKeyAgree,
  lenientAgree,
  lenientKeys,
  leadingTokens,
  nameVariants,
  normalizeLabel,
  pctOf,
  round,
  variantAgree,
  variantKeys,
} from "../../pipeline/lib/lines-gate";

describe("round and pctOf", () => {
  it("rounds to the requested decimals", () => {
    expect(round(1.26)).toBe(1.3);
    expect(round(1.2345, 2)).toBe(1.23);
  });

  it("is null without a positive denominator", () => {
    expect(pctOf(5, 0)).toBeNull();
    expect(pctOf(5, -1)).toBeNull();
    expect(pctOf(Number.NaN, 10)).toBeNull();
    expect(pctOf(0, 10)).toBe(0);
    expect(pctOf(1, 3)).toBe(33.3);
  });
});

describe("normalizeLabel", () => {
  it("merges case and spacing variants and names the empty value", () => {
    expect(normalizeLabel("Vigente")).toBe("vigente");
    expect(normalizeLabel("VIgente")).toBe(normalizeLabel(" VIGENTE "));
    expect(normalizeLabel("En  revisión")).toBe("en revisión");
    expect(normalizeLabel(null)).toBe("(none)");
    expect(normalizeLabel("  ")).toBe("(none)");
  });
});

describe("nameVariants", () => {
  it("expands the leading abbreviations", () => {
    expect(nameVariants("R. Primero")).toEqual(["río Primero"]);
    expect(nameVariants("A. del Gato")).toEqual(["arroyo del Gato"]);
    expect(nameVariants("Cda. Busto")).toEqual(["cañada Busto"]);
    expect(nameVariants("C. del Tajamar")).toEqual(["cañada del Tajamar"]);
    expect(nameVariants("Q. de la Mina")).toEqual(["quebrada de la Mina"]);
  });

  it("expands a glued abbreviation and one inside the name", () => {
    expect(nameVariants("A.Yerutí*").map((v) => v.toLowerCase())).toEqual([
      "arroyo yerutí",
    ]);
    expect(nameVariants("Brazo R. De los Sauces")).toEqual([
      "Brazo río De los Sauces",
    ]);
  });

  it("makes a parenthesised alternative a variant of its own, with the type word", () => {
    expect(nameVariants("R. Primero (Suquía)")).toEqual([
      "río Primero",
      "Suquía",
      "río Suquía",
    ]);
  });

  it("does not add the type word when the alternative already has one", () => {
    expect(nameVariants("A. Seco (Quebrada de Luna)")).toEqual([
      "arroyo Seco",
      "Quebrada de Luna",
    ]);
  });

  it("drops a leading 'o' in the alternative and unnamed parentheses", () => {
    expect(nameVariants("A. de Eduviges (o El Manso)")).toContain(
      "arroyo El Manso",
    );
    expect(nameVariants("A. Cerco (  )")).toEqual(["arroyo Cerco"]);
  });

  it("leaves other abbreviations and names alone, and is empty for nothing", () => {
    expect(nameVariants("Río Suquía")).toEqual(["Río Suquía"]);
    expect(nameVariants("Sta. Rosa")).toEqual(["Sta. Rosa"]);
    expect(nameVariants("")).toEqual([]);
    expect(nameVariants(null)).toEqual([]);
    expect(nameVariants(" * ")).toEqual([]);
  });
});

describe("name agreement", () => {
  it("variantKeys are accent-, case- and punctuation-free", () => {
    expect(variantKeys("R. Tercero (Ctalamochita)")).toEqual([
      "rio tercero",
      "ctalamochita",
      "rio ctalamochita",
    ]);
  });

  it("agrees through an abbreviation and an accent", () => {
    expect(variantAgree("A. del Gato", "Arroyo del Gato")).toBe(true);
    expect(variantAgree("R. Quinto", "RIO QUINTO")).toBe(true);
    expect(variantAgree("Cda. Santa Lucía", "Cañada Santa Lucia")).toBe(true);
  });

  it("agrees through the parenthesised alternative", () => {
    expect(variantAgree("R. Primero (Suquía)", "Río Suquía")).toBe(true);
    expect(variantAgree("R. Primero (Suquía)", "Río Primero")).toBe(true);
    expect(variantAgree("Río Suquía", "R. Primero (Suquía)")).toBe(true);
  });

  it("does not agree for different rivers or different types", () => {
    expect(variantAgree("R. Primero", "Río Segundo")).toBe(false);
    expect(variantAgree("A. Seco", "Río Seco")).toBe(false);
    expect(variantAgree("", "Río Seco")).toBe(false);
    expect(variantAgree(null, null)).toBe(false);
  });

  it("strict agreement uses the plain key only", () => {
    expect(exactKeyAgree("Río Suquía", "RÍO SUQUIA")).toBe(true);
    expect(exactKeyAgree("R. Primero (Suquía)", "Río Suquía")).toBe(false);
    expect(exactKeyAgree("A. del Gato", "Arroyo del Gato")).toBe(false);
    expect(exactKeyAgree("", "")).toBe(false);
  });
});

describe("lenient agreement", () => {
  it("ignores articles and prepositions", () => {
    expect(lenientKeys("R. de los Sauces")).toEqual(["rio sauces"]);
    expect(lenientAgree("R. Guasapampa", "Río de Guasapampa")).toBe(true);
    expect(lenientAgree("A. El Chato", "Arroyo Chato")).toBe(true);
    expect(variantAgree("R. Guasapampa", "Río de Guasapampa")).toBe(false);
  });

  it("still tells different rivers and types apart", () => {
    expect(lenientAgree("R. Soto", "Río Pinto")).toBe(false);
    expect(lenientAgree("A. Seco", "Río Seco")).toBe(false);
    expect(lenientAgree("R. de", "Río de")).toBe(true);
    expect(lenientAgree(null, "Río Seco")).toBe(false);
  });

  it("splits a lone 'o' into an alternative name", () => {
    expect(nameVariants("Arroyo Las Saladas o de las Mojarras")).toEqual([
      "Arroyo Las Saladas",
      "de las Mojarras",
      "Arroyo de las Mojarras",
    ]);
    expect(
      lenientAgree(
        "A. Las Saladas (de las Mojarras)",
        "Arroyo Las Saladas o de las Majarras",
      ),
    ).toBe(true);
  });
});

describe("leadingTokens", () => {
  it("counts first tokens, most frequent first, ties by token", () => {
    expect(
      leadingTokens(["A. Seco", "A. Grande", "R. Primero", "Cda. X", "R. Y"]),
    ).toEqual([
      { token: "A.", count: 2 },
      { token: "R.", count: 2 },
      { token: "Cda.", count: 1 },
    ]);
    expect(leadingTokens(["a b", "c d", "e f"], 2)).toHaveLength(2);
  });
});

describe("detailVerdict", () => {
  it("is real detail when both shares reach their thresholds", () => {
    expect(detailVerdict(30, 100, 200)).toEqual({
      extraDetailKm: 30,
      extraPctOfSource: 30,
      addsPctOverBaseline: 15,
      realExtraDetail: true,
    });
  });

  it("is exactly at the thresholds on unrounded values", () => {
    expect(detailVerdict(20, 100, 200).realExtraDetail).toBe(true);
    expect(detailVerdict(19.99, 100, 200).realExtraDetail).toBe(false);
  });

  it("needs both conditions", () => {
    // 50% of a small source, but only 5% of the baseline
    expect(detailVerdict(10, 20, 200).realExtraDetail).toBe(false);
    // 10% of the baseline, but only 10% of a big source
    expect(detailVerdict(20, 200, 200).realExtraDetail).toBe(false);
  });

  it("never passes with a zero or missing denominator", () => {
    expect(detailVerdict(10, 0, 100)).toMatchObject({
      extraPctOfSource: null,
      realExtraDetail: false,
    });
    expect(detailVerdict(10, 100, 0)).toMatchObject({
      addsPctOverBaseline: null,
      realExtraDetail: false,
    });
    expect(detailVerdict(0, 100, 100)).toMatchObject({
      extraPctOfSource: 0,
      realExtraDetail: false,
    });
  });

  it("accepts other thresholds", () => {
    expect(detailVerdict(5, 100, 100, 5, 5).realExtraDetail).toBe(true);
  });
});
