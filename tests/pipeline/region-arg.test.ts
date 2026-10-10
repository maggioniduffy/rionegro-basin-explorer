import { describe, expect, it } from "vitest";
import { parseRegionArg } from "@/pipeline/lib/paths";

describe("parseRegionArg", () => {
  it("defaults to nqn without --region", () => {
    expect(parseRegionArg(["node", "step.ts"])).toBe("nqn");
  });

  it("reads --region <id> and --region=<id>", () => {
    expect(parseRegionArg(["node", "step.ts", "--region", "nqn"])).toBe("nqn");
    expect(parseRegionArg(["node", "step.ts", "--region=nqn"])).toBe("nqn");
  });

  it("rejects unknown or missing ids", () => {
    expect(() =>
      parseRegionArg(["node", "step.ts", "--region", "xyz"]),
    ).toThrow(/--region must be one of nqn/);
    expect(() => parseRegionArg(["node", "step.ts", "--region"])).toThrow(
      /got nothing/,
    );
  });
});
