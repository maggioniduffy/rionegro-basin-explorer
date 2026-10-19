import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { REGION_IDS } from "./regions/index";
import { localVersions, type ContentKind } from "./lib/content-hash";

const withNextIntl = createNextIntlPlugin();

type Versions = Record<ContentKind, Record<string, string>>;

/** Local builds hash public output; deployed builds use the committed R2 manifest. */
function versions(): Versions {
  if (!process.env.CONTENT_ORIGIN)
    return { tiles: localVersions("tiles"), flow: localVersions("flow") };
  const manifest = join(process.cwd(), "content", "versions.json");
  if (!existsSync(manifest))
    throw new Error("CONTENT_ORIGIN requires content/versions.json");
  const parsed: unknown = JSON.parse(readFileSync(manifest, "utf8"));
  if (!parsed || typeof parsed !== "object")
    throw new Error("content/versions.json must be an object");
  const value = parsed as Partial<Versions>;
  const result = { tiles: value.tiles ?? {}, flow: value.flow ?? {} };
  // A served region without a published version would 404 its tiles silently.
  for (const id of REGION_IDS) {
    if (!result.tiles[id])
      throw new Error(
        `CONTENT_ORIGIN is set but content/versions.json has no tiles version for region ${id}: run content:publish`,
      );
    const hasFlow = existsSync(
      join(process.cwd(), "regions", id, "flow.config.json"),
    );
    if (hasFlow && !result.flow[id])
      throw new Error(
        `CONTENT_ORIGIN is set but content/versions.json has no flow version for region ${id}: run content:publish --kind flow`,
      );
  }
  return result;
}

const contentVersions = versions();
const contentOrigin = process.env.CONTENT_ORIGIN?.replace(/\/$/, "");

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_TILES_VERSIONS: JSON.stringify(contentVersions.tiles),
    NEXT_PUBLIC_FLOW_VERSIONS: JSON.stringify(contentVersions.flow),
  },
  async rewrites() {
    const local = [
      {
        source: "/tiles/:region/:version/:file",
        destination: "/tiles/:region/:file",
      },
      {
        source: "/flow/:region/:version/:file",
        destination: "/flow/:region/:file",
      },
      // Pages loaded before tiles moved per region (2026-10-10) still ask for
      // /tiles/<hash>/<file>; real files under /tiles/<region>/ are served first.
      { source: "/tiles/:version/:file", destination: "/tiles/nqn/:file" },
    ];
    if (!contentOrigin) return local;
    return [
      {
        source: "/tiles/:region/:version/:file",
        destination: `${contentOrigin}/tiles/:region/:version/:file`,
        basePath: false,
      },
      {
        source: "/flow/:region/:version/:file",
        destination: `${contentOrigin}/flow/:region/:version/:file`,
        basePath: false,
      },
      {
        source: "/tiles/:version/:file",
        destination: `${contentOrigin}/tiles/nqn/:version/:file`,
        basePath: false,
      },
    ];
  },
  async headers() {
    const immutable = [
      { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
      { key: "x-vercel-enable-rewrite-caching", value: "1" },
    ];
    return [
      { source: "/tiles/:region/:version/:file", headers: immutable },
      { source: "/flow/:region/:version/:file", headers: immutable },
    ];
  },
};

export default withNextIntl(nextConfig);
