import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "../proxy";
import { HUB_HEADER, REGION_HEADER } from "../regions/hosts";

const req = (url: string, extra: Record<string, string> = {}) =>
  new NextRequest(url, { headers: { host: new URL(url).host, ...extra } });
const rewrite = (r: Response) => r.headers.get("x-middleware-rewrite");
const location = (r: Response) => r.headers.get("location");
// NextResponse.next({ request: { headers } }) passes the request headers as overrides.
const header = (r: Response, name: string) =>
  r.headers.get(`x-middleware-request-${name}`);

describe("proxy: regions by path (owner, 2026-10-12)", () => {
  it("serves the hub at / on every host", () => {
    for (const url of [
      "https://basinexplorer.vercel.app/",
      "http://localhost:3000/",
      "https://basin-explorer-git-main.vercel.app/",
    ]) {
      const r = proxy(req(url));
      expect(new URL(rewrite(r)!).pathname).toBe("/hub");
      expect(header(r, HUB_HEADER)).toBe("1");
    }
  });

  it("passes a region path with its region header, never one a client sent", () => {
    const r = proxy(
      req("https://basinexplorer.vercel.app/cordoba/map", {
        [REGION_HEADER]: "nqn",
        [HUB_HEADER]: "1",
      }),
    );
    expect(r.status).toBe(200);
    expect(rewrite(r)).toBeNull();
    expect(header(r, REGION_HEADER)).toBe("cba");
    expect(header(r, HUB_HEADER)).toBeNull();
    const api = proxy(req("http://localhost:3000/rionegro/api/search?q=limay"));
    expect(header(api, REGION_HEADER)).toBe("nqn");
  });

  it("sends links from before /map to the region's map", () => {
    const r = proxy(req("http://localhost:3000/rionegro?r=limay"));
    expect(r.status).toBe(308);
    expect(location(r)).toBe("http://localhost:3000/rionegro/map?r=limay");
  });

  it("redirects a region id to its slug", () => {
    const r = proxy(req("https://basinexplorer.vercel.app/cba/map?r=tercero"));
    expect(r.status).toBe(308);
    expect(location(r)).toBe(
      "https://basinexplorer.vercel.app/cordoba/map?r=tercero",
    );
  });

  it("redirects the old region hosts to the region path", () => {
    const alias = proxy(
      req("https://rionegrobasinexplorer.vercel.app/?r=limay"),
    );
    expect(alias.status).toBe(308);
    expect(location(alias)).toBe(
      "https://basinexplorer.vercel.app/rionegro/map?r=limay",
    );
    const dev = proxy(req("http://cordoba.localhost:3000/attributions"));
    expect(location(dev)).toBe("http://localhost:3000/cordoba/attributions");
    const home = proxy(req("https://cordobabasinexplorer.vercel.app/"));
    expect(location(home)).toBe("https://basinexplorer.vercel.app/cordoba");
  });

  it("sets the locale cookie and drops the prefix", () => {
    const r = proxy(req("http://localhost:3000/es/cordoba/map"));
    expect(r.status).toBe(308);
    expect(location(r)).toBe("http://localhost:3000/cordoba/map");
    expect(r.headers.get("set-cookie")).toContain("es");
  });

  it("gives any other path the shared messages (the 404 page names no region)", () => {
    const r = proxy(req("http://localhost:3000/map"));
    expect(rewrite(r)).toBeNull();
    expect(header(r, HUB_HEADER)).toBe("1");
    expect(header(r, REGION_HEADER)).toBeNull();
  });
});
