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

  it("reads the production aliases and the dev labels (owner, 2026-10-12)", () => {
    expect(regionFromHost("cordobabasinexplorer.vercel.app")).toBe("cba");
    expect(regionFromHost("rionegrobasinexplorer.vercel.app")).toBe("nqn");
    expect(regionFromHost("cordoba.localhost:3000")).toBe("cba");
    expect(regionFromHost("rionegro.localhost:3000")).toBe("nqn");
  });

  it("reads a region id as a dev label", () => {
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

  it("serves the hub on basinexplorer.vercel.app, plain localhost and HUB_HOSTS only", () => {
    expect(isHubHost("basinexplorer.vercel.app", env)).toBe(true);
    expect(isHubHost("localhost:3000", env)).toBe(true);
    expect(
      isHubHost("explorer.example.org", { HUB_HOSTS: "explorer.example.org" }),
    ).toBe(true);
    for (const host of [
      "rionegrobasinexplorer.vercel.app",
      "cordobabasinexplorer.vercel.app",
      "cordoba.localhost:3000",
      null,
    ])
      expect(isHubHost(host, env)).toBe(false);
  });

  it("links each region to its production alias, or one label above localhost in dev", () => {
    expect(regionOrigin("cba", "basinexplorer.vercel.app", "https", env)).toBe(
      "https://cordobabasinexplorer.vercel.app",
    );
    expect(regionOrigin("nqn", "basinexplorer.vercel.app", "https", env)).toBe(
      "https://rionegrobasinexplorer.vercel.app",
    );
    expect(regionOrigin("nqn", "localhost:3000", "http", env)).toBe(
      "http://rionegro.localhost:3000",
    );
    expect(
      regionOrigin("cba", "basinexplorer.vercel.app", "https", {
        REGION_URLS: "nqn=https://a.vercel.app, cba=https://b.vercel.app/",
      }),
    ).toBe("https://b.vercel.app");
  });

  it("links back to the hub from the production aliases, dev labels or HUB_URL", () => {
    for (const host of [
      "cordobabasinexplorer.vercel.app",
      "rionegrobasinexplorer.vercel.app",
    ])
      expect(hubOrigin(host, "https", env)).toBe(
        "https://basinexplorer.vercel.app",
      );
    expect(hubOrigin("cba.localhost:3000", "http", env)).toBe(
      "http://localhost:3000",
    );
    expect(hubOrigin("xyz.example.com", "https", env)).toBeNull();
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
