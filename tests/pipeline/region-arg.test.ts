import { describe, expect, it } from "vitest";
import { parseRegionArg } from "@/pipeline/lib/paths";

describe("parseRegionArg", () => {
  it("requires --region outside the test runner", () => {
    expect(() => parseRegionArg(["node", "step.ts"], {})).toThrow(
      /pass --region <id>/,
    );
  });

  it("defaults to nqn under the test runner only", () => {
    expect(parseRegionArg(["node", "step.ts"], { VITEST: "true" })).toBe("nqn");
  });

  it("reads --region <id> and --region=<id>", () => {
    expect(parseRegionArg(["node", "step.ts", "--region", "nqn"])).toBe("nqn");
    expect(parseRegionArg(["node", "step.ts", "--region=nqn"])).toBe("nqn");
  });

  it("accepts a region the app doesn't serve yet", () => {
    expect(parseRegionArg(["node", "step.ts", "--region", "cba"])).toBe("cba");
  });

  it("rejects unknown or missing ids", () => {
    expect(() =>
      parseRegionArg(["node", "step.ts", "--region", "xyz"]),
    ).toThrow(/--region must be one of nqn, cba/);
    expect(() => parseRegionArg(["node", "step.ts", "--region"])).toThrow(
      /got nothing/,
    );
  });
});
