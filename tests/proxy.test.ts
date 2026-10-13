import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "../proxy";

const req = (url: string, extra: Record<string, string> = {}) =>
  new NextRequest(url, { headers: { host: new URL(url).host, ...extra } });
const rewrite = (r: Response) => r.headers.get("x-middleware-rewrite");

describe("proxy and the hub (R4)", () => {
  it("rewrites a hub host's / to app/hub", () => {
    const r = proxy(req("https://basinexplorer.vercel.app/"));
    expect(new URL(rewrite(r)!).pathname).toBe("/hub");
  });

  it("answers 404 for other hub paths, but passes region-prefixed ones (OG images)", () => {
    expect(proxy(req("https://basinexplorer.vercel.app/map")).status).toBe(404);
    const og = proxy(
      req("https://basinexplorer.vercel.app/nqn/opengraph-image/og"),
    );
    expect(og.status).toBe(200);
    expect(rewrite(og)).toBeNull();
  });

  it("routes region hosts as before", () => {
    const r = proxy(req("https://rionegro.basinexplorer.vercel.app/map"));
    expect(new URL(rewrite(r)!).pathname).toBe("/nqn/map");
    const old = proxy(req("https://rionegrobasinexplorer.vercel.app/"));
    expect(new URL(rewrite(old)!).pathname).toBe("/nqn");
  });
});
