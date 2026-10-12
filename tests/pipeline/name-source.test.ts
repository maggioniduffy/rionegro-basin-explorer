import { describe, expect, it } from "vitest";
import { resolveNameSource } from "../../pipeline/lib/name-source";

describe("resolveNameSource", () => {
  it("defaults to ign-match with the unchanged nqn provenance strings", () => {
    for (const v of [undefined, "ign-match"]) {
      const s = resolveNameSource(v, "nqn");
      expect(s.step).toBe("ign-match");
      expect(s.riverNameProvenance).toBe(
        "pipeline/names.json (hand-approved; IGN spelling, FUENTE: Instituto Geográfico Nacional de la República Argentina)",
      );
      expect(s.streamNameProvenance).toBe(
        "pipeline:ign-streams: most frequent IGN spelling of the stream's name (pipeline:ign-match)",
      );
    }
  });

  it("line-names names APRHI inside the province and IGN outside", () => {
    const s = resolveNameSource("line-names", "cba");
    expect(s.step).toBe("line-names");
    for (const text of [s.riverNameProvenance, s.streamNameProvenance]) {
      expect(text).toContain("APRHI");
      expect(text).toContain("Portal de Información Hídrica de Córdoba");
      expect(text).toContain("Instituto Geográfico Nacional");
      expect(text).toContain("pipeline:line-names");
    }
    expect(s.riverNameProvenance).toContain("regions/cba/names.json");
  });

  it("rejects an unknown value instead of guessing", () => {
    expect(() => resolveNameSource("osm", "cba")).toThrow(/namesFrom/);
    expect(() => resolveNameSource(null, "cba")).toThrow(/namesFrom/);
  });
});
