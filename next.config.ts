import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

/**
 * Content hash of the PMTiles archives, so their URLs change only when the tiles do
 * (lib/map/config.ts TILE_PATHS). Files in /public are served with max-age=0, so
 * without it every range request goes back to the server. A versioned URL can be
 * cached for good: PMTiles cannot catch a stale cached header itself, because it
 * ignores weak ETags, which is what the server sends.
 */
function tilesVersion(): string {
  const dir = join(process.cwd(), "public", "tiles");
  const hash = createHash("sha256");
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith(".pmtiles")) continue;
    hash.update(file).update(readFileSync(join(dir, file)));
  }
  return hash.digest("hex").slice(0, 12);
}

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_TILES_VERSION: tilesVersion() },
  async rewrites() {
    return [{ source: "/tiles/:version/:file", destination: "/tiles/:file" }];
  },
  async headers() {
    return [
      {
        source: "/tiles/:version/:file",
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
