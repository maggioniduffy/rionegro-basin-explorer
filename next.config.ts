import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

/**
 * Content hash of each region's PMTiles archives (public/tiles/<region>/), so their URLs
 * change only when the tiles do (lib/map/config.ts tilePaths). Files in /public are served
 * with max-age=0, so without it every range request goes back to the server. A versioned
 * URL can be cached for good: PMTiles cannot catch a stale cached header itself, because
 * it ignores weak ETags, which is what the server sends.
 */
function tilesVersions(): Record<string, string> {
  const root = join(process.cwd(), "public", "tiles");
  const versions: Record<string, string> = {};
  for (const region of readdirSync(root, { withFileTypes: true })) {
    if (!region.isDirectory()) continue;
    const dir = join(root, region.name);
    const hash = createHash("sha256");
    for (const file of readdirSync(dir).sort()) {
      if (!file.endsWith(".pmtiles")) continue;
      hash.update(file).update(readFileSync(join(dir, file)));
    }
    versions[region.name] = hash.digest("hex").slice(0, 12);
  }
  return versions;
}

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_TILES_VERSIONS: JSON.stringify(tilesVersions()) },
  async rewrites() {
    return [
      {
        source: "/tiles/:region/:version/:file",
        destination: "/tiles/:region/:file",
      },
      // Pages loaded before tiles moved per region (2026-10-10) still ask for
      // /tiles/<hash>/<file>; real files under /tiles/<region>/ are served first.
      { source: "/tiles/:version/:file", destination: "/tiles/nqn/:file" },
    ];
  },
  async headers() {
    return [
      {
        source: "/tiles/:region/:version/:file",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
