import { describe, expect, it } from "vitest";
import { regionFromHost } from "@/regions/hosts";

describe("regionFromHost", () => {
  it("reads a region id from the first label, with or without a port", () => {
    expect(regionFromHost("nqn.example.com")).toBe("nqn");
    expect(regionFromHost("NQN.localhost:3000")).toBe("nqn");
  });

  it("returns a known region that isn't served yet as is (proxy.ts answers 404)", () => {
    expect(regionFromHost("cba.localhost:3000")).toBe("cba");
  });

  it("serves the default region for any other host", () => {
    expect(regionFromHost("rionegrobasinexplorer.vercel.app")).toBe("nqn");
    expect(regionFromHost("localhost:3000")).toBe("nqn");
    expect(regionFromHost("xyz.example.com")).toBe("nqn");
    expect(regionFromHost(null)).toBe("nqn");
  });
});
