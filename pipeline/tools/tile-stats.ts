/**
 * tile-stats — read-only per-zoom summary of a PMTiles archive: tile count, tile bytes
 * (min / median / max, compressed as stored), and per layer the features and vertices
 * per tile (total and worst tile). With --by=<prop>, vertices are also split by that
 * property's value (e.g. --by=level for the mask). Prints a compact table, no rows.
 *
 *   npx tsx pipeline/tools/tile-stats.ts public/tiles/mask.pmtiles [--by=level]
 */
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { parseArgs } from "node:util";
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import {
  Compression,
  PMTiles,
  type Source,
  type RangeResponse,
  tileIdToZxy,
  type Entry,
} from "pmtiles";

class FileSource implements Source {
  constructor(
    private buf: Buffer,
    private name: string,
  ) {}
  getKey() {
    return this.name;
  }
  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    // A copy, so the result is a plain ArrayBuffer.
    return {
      data: new Uint8Array(this.buf.subarray(offset, offset + length)).buffer,
    };
  }
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { by: { type: "string" } },
});
const file = positionals[0];
if (!file) throw new Error("usage: tile-stats <file.pmtiles> [--by=prop]");

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)] ?? 0;
};

async function main() {
  const buf = await readFile(file!);
  const pm = new PMTiles(new FileSource(buf, file!));
  const header = await pm.getHeader();
  // Walk the directory tree to list every tile entry.
  const entries: { z: number; x: number; y: number; stored: number }[] = [];
  const walk = async (offset: number, length: number) => {
    const raw = new Uint8Array(buf.subarray(offset, offset + length));
    const data =
      header.internalCompression === Compression.Gzip ? gunzipSync(raw) : raw;
    const dir = deserialize(new Uint8Array(data));
    for (const e of dir) {
      if (e.runLength === 0) {
        await walk(header.leafDirectoryOffset + e.offset, e.length);
      } else {
        for (let i = 0; i < e.runLength; i++) {
          const [z, x, y] = tileIdToZxy(e.tileId + i);
          // A run shares one stored blob (identical tiles).
          entries.push({ z, x, y, stored: i === 0 ? e.length : 0 });
        }
      }
    }
  };
  await walk(header.rootDirectoryOffset, header.rootDirectoryLength);

  type Acc = {
    tiles: number;
    bytes: number[];
    layers: Map<
      string,
      { features: number; vertices: number; maxTileVertices: number }
    >;
    by: Map<string, number>;
    maxTileVertices: number;
  };
  const perZoom = new Map<number, Acc>();
  for (const { z, x, y, stored } of entries) {
    const res = await pm.getZxy(z, x, y);
    if (!res) continue;
    const bytes = stored;
    const acc =
      perZoom.get(z) ??
      ({
        tiles: 0,
        bytes: [],
        layers: new Map(),
        by: new Map(),
        maxTileVertices: 0,
      } as Acc);
    perZoom.set(z, acc);
    acc.tiles++;
    acc.bytes.push(bytes);
    const vt = new VectorTile(new PbfReader(new Uint8Array(res.data)));
    let tileVerts = 0;
    for (const [name, layer] of Object.entries(vt.layers)) {
      const l = acc.layers.get(name) ?? {
        features: 0,
        vertices: 0,
        maxTileVertices: 0,
      };
      acc.layers.set(name, l);
      let lv = 0;
      for (let i = 0; i < layer.length; i++) {
        const f = layer.feature(i);
        const n = f
          .loadGeometry()
          .reduce((s: number, ring: unknown[]) => s + ring.length, 0);
        l.features++;
        lv += n;
        if (values.by) {
          const key = `${name}:${String(f.properties[values.by])}`;
          acc.by.set(key, (acc.by.get(key) ?? 0) + n);
        }
      }
      l.vertices += lv;
      l.maxTileVertices = Math.max(l.maxTileVertices, lv);
      tileVerts += lv;
    }
    acc.maxTileVertices = Math.max(acc.maxTileVertices, tileVerts);
  }

  console.log(
    `${file}: ${(buf.byteLength / 1024).toFixed(0)} KB, z${header.minZoom}–${header.maxZoom}, ${entries.length} tiles`,
  );
  for (const [z, a] of [...perZoom].sort((p, q) => p[0] - q[0])) {
    const layers = [...a.layers]
      .map(
        ([n, l]) =>
          `${n} f=${l.features} v=${l.vertices} vmax=${l.maxTileVertices}`,
      )
      .join(" | ");
    console.log(
      `z${z} tiles=${a.tiles} KB min/med/max=${(Math.min(...a.bytes) / 1024).toFixed(1)}/${(median(a.bytes) / 1024).toFixed(1)}/${(Math.max(...a.bytes) / 1024).toFixed(1)} sumKB=${(a.bytes.reduce((s, b) => s + b, 0) / 1024).toFixed(0)} vmaxTile=${a.maxTileVertices} :: ${layers}`,
    );
    if (values.by)
      console.log(
        `   by ${values.by}: ${[...a.by]
          .sort()
          .map(([k, v]) => `${k}=${v}`)
          .join(" ")}`,
      );
  }
}

// pmtiles v4 does not export its directory decoder; this mirrors the spec (v3).
function deserialize(buf: Uint8Array): Entry[] {
  let pos = 0;
  const varint = () => {
    let result = 0;
    let shift = 1;
    for (;;) {
      const b = buf[pos++]!;
      result += (b & 0x7f) * shift;
      if (b < 0x80) return result;
      shift *= 128;
    }
  };
  const n = varint();
  const entries: Entry[] = [];
  let last = 0;
  for (let i = 0; i < n; i++) {
    last += varint();
    entries.push({ tileId: last, offset: 0, length: 0, runLength: 1 });
  }
  for (const e of entries) e.runLength = varint();
  for (const e of entries) e.length = varint();
  for (let i = 0; i < n; i++) {
    const v = varint();
    const e = entries[i]!;
    const prev = entries[i - 1];
    e.offset = v === 0 && prev ? prev.offset + prev.length : v - 1;
  }
  return entries;
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
