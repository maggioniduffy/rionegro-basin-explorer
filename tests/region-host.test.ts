import { describe, expect, it } from "vitest";
import {
  hubOrigin,
  isHubHost,
  protocolOf,
  regionFromHost,
  regionOrigin,
} from "@/regions/hosts";

describe("regionFromHost", () => {
  it("reads a region id from the first label, with or without a port", () => {
    expect(regionFromHost("nqn.example.com")).toBe("nqn");
    expect(regionFromHost("NQN.localhost:3000")).toBe("nqn");
  });

  it("reads the region's host label (owner, 2026-10-12)", () => {
    expect(regionFromHost("cordoba.basinexplorer.vercel.app")).toBe("cba");
    expect(regionFromHost("rionegro.basinexplorer.vercel.app")).toBe("nqn");
    expect(regionFromHost("cordoba.localhost:3000")).toBe("cba");
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

describe("hub hosts (R4)", () => {
  const env = {};

  it("serves the hub on basinexplorer.vercel.app, hub.* and HUB_HOSTS only", () => {
    expect(isHubHost("basinexplorer.vercel.app", env)).toBe(true);
    expect(isHubHost("hub.localhost:3000", env)).toBe(true);
    expect(
      isHubHost("explorer.example.org", { HUB_HOSTS: "explorer.example.org" }),
    ).toBe(true);
    for (const host of [
      "rionegrobasinexplorer.vercel.app",
      "localhost:3000",
      "cordoba.basinexplorer.vercel.app",
      null,
    ])
      expect(isHubHost(host, env)).toBe(false);
  });

  it("links each region one label above the hub, or by swapping hub. in dev", () => {
    expect(regionOrigin("cba", "basinexplorer.vercel.app", "https", env)).toBe(
      "https://cordoba.basinexplorer.vercel.app",
    );
    expect(regionOrigin("nqn", "hub.localhost:3000", "http", env)).toBe(
      "http://rionegro.localhost:3000",
    );
    expect(
      regionOrigin("cba", "basinexplorer.vercel.app", "https", {
        REGION_URLS: "nqn=https://a.vercel.app, cba=https://b.vercel.app/",
      }),
    ).toBe("https://b.vercel.app");
  });

  it("links back to the hub only from a region-label host, or HUB_URL", () => {
    expect(hubOrigin("cordoba.basinexplorer.vercel.app", "https", env)).toBe(
      "https://basinexplorer.vercel.app",
    );
    expect(hubOrigin("cba.localhost:3000", "http", env)).toBe(
      "http://hub.localhost:3000",
    );
    expect(
      hubOrigin("rionegrobasinexplorer.vercel.app", "https", env),
    ).toBeNull();
    expect(hubOrigin("localhost:3000", "http", env)).toBeNull();
    expect(
      hubOrigin("localhost:3000", "http", {
        HUB_URL: "https://hub.example.org/",
      }),
    ).toBe("https://hub.example.org");
  });

  it("uses http on localhost unless the request says otherwise", () => {
    expect(protocolOf("cba.localhost:3000", null)).toBe("http");
    expect(protocolOf("basinexplorer.vercel.app", null)).toBe("https");
    expect(protocolOf("x.localhost", "https")).toBe("https");
  });
});
