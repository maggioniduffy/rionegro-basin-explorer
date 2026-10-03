/**
 * og-shapes — SVG paths of the basin, its lakes and its main rivers for the Open Graph
 * image (app/opengraph-image.tsx), read from public/tiles/rivers.pmtiles at one zoom.
 * No new data: the same tiles the map draws. Coordinates stay in Web Mercator, fitted
 * into the image's map box. Rerun after rebuilding the tiles:
 *
 *   npx tsx scripts/og-shapes.ts
 *
 * Writes app/og-shapes.json and prints its size.
 */
import { readFile, writeFile } from "node:fs/promises";
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { PMTiles, type RangeResponse, type Source } from "pmtiles";
import { OG_MAP_BOX } from "../lib/og";

const TILES = "public/tiles/rivers.pmtiles";
const OUT = "app/og-shapes.json";
const ZOOM = 5;
/** Reaches of this Strahler order and up, as the minimap's overview (MINIMAP_MIN_STRAHLER is 5). */
const MIN_STRAHLER = 4;

class FileSource implements Source {
  constructor(private buf: Buffer) {}
  getKey() {
    return TILES;
  }
  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    return {
      data: new Uint8Array(this.buf.subarray(offset, offset + length)).buffer,
    };
  }
}

type Pt = [number, number];
type Shape = { rings: Pt[][]; strahler?: number };

async function main() {
  const pm = new PMTiles(new FileSource(await readFile(TILES)));
  const header = await pm.getHeader();
  const n = 2 ** ZOOM;
  const tx = (lon: number) => Math.floor(((lon + 180) / 360) * n);
  const ty = (lat: number) => {
    const r = (lat * Math.PI) / 180;
    return Math.floor(
      ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n,
    );
  };

  const layers: Record<"basin" | "lakes" | "reaches", Shape[]> = {
    basin: [],
    lakes: [],
    reaches: [],
  };
  for (let x = tx(header.minLon); x <= tx(header.maxLon); x++) {
    for (let y = ty(header.maxLat); y <= ty(header.minLat); y++) {
      const res = await pm.getZxy(ZOOM, x, y);
      if (!res) continue;
      const vt = new VectorTile(new PbfReader(new Uint8Array(res.data)));
      for (const name of ["basin", "lakes", "reaches"] as const) {
        const layer = vt.layers[name];
        if (!layer) continue;
        for (let i = 0; i < layer.length; i++) {
          const f = layer.feature(i);
          const strahler = Number(f.properties.strahler);
          if (name === "reaches" && !(strahler >= MIN_STRAHLER)) continue;
          // Tile units to global units at this zoom, so tiles join up.
          const rings = f
            .loadGeometry()
            .map((ring) =>
              ring.map((p): Pt => [
                (x + p.x / layer.extent) * 256,
                (y + p.y / layer.extent) * 256,
              ]),
            );
          layers[name].push(
            name === "reaches" ? { rings, strahler } : { rings },
          );
        }
      }
    }
  }
  if (layers.basin.length === 0) throw new Error(`no basin at z${ZOOM}`);

  // Fit the basin's extent into the map box.
  const all = layers.basin.flatMap((s) => s.rings.flat());
  const minX = Math.min(...all.map((p) => p[0]));
  const maxX = Math.max(...all.map((p) => p[0]));
  const minY = Math.min(...all.map((p) => p[1]));
  const maxY = Math.max(...all.map((p) => p[1]));
  const scale = Math.min(
    OG_MAP_BOX.width / (maxX - minX),
    OG_MAP_BOX.height / (maxY - minY),
  );
  const offX = (OG_MAP_BOX.width - (maxX - minX) * scale) / 2;
  const offY = (OG_MAP_BOX.height - (maxY - minY) * scale) / 2;
  const fmt = (v: number) => Math.round(v * 10) / 10;
  const toPath = (rings: Pt[][], close: boolean) =>
    rings
      .map(
        (ring) =>
          "M" +
          ring
            .map(
              ([px, py]) =>
                `${fmt(offX + (px - minX) * scale)} ${fmt(offY + (py - minY) * scale)}`,
            )
            .join("L") +
          (close ? "Z" : ""),
      )
      .join("");

  const reachesByOrder = new Map<number, Pt[][]>();
  for (const r of layers.reaches) {
    const list = reachesByOrder.get(r.strahler!) ?? [];
    list.push(...r.rings);
    reachesByOrder.set(r.strahler!, list);
  }
  const out = {
    source: `${TILES} z${ZOOM}`,
    basin: toPath(
      layers.basin.flatMap((s) => s.rings),
      true,
    ),
    lakes: toPath(
      layers.lakes.flatMap((s) => s.rings),
      true,
    ),
    rivers: [...reachesByOrder]
      .sort((a, b) => a[0] - b[0])
      .map(([strahler, rings]) => ({ strahler, d: toPath(rings, false) })),
  };
  const json = JSON.stringify(out);
  await writeFile(OUT, json + "\n");
  console.log(
    `${OUT}: ${(json.length / 1024).toFixed(1)} KB, basin parts ${layers.basin.length}, lakes ${layers.lakes.length}, reaches ${layers.reaches.length}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
