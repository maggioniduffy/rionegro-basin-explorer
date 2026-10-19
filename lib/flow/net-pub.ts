import type { FlowNet } from "./net-schema";
import type { FlowNetPub } from "./net-pub-schema";

/**
 * flow-net/1 <-> flow-net-pub/1 (format in net-pub-schema.ts). Pure, no Node APIs: the pipeline
 * encodes with it and the app decodes with it.
 */

const R = 6371008.8;
const RAD = Math.PI / 180;

export interface DecodedNet {
  id: string;
  region: string;
  origin: [number, number];
  bbox: [number, number, number, number];
  courseLengthM: number;
  source: FlowNetPub["source"];
  model: FlowNetPub["model"];
  qa: FlowNetPub["qa"];
  nodes: {
    lon: number[];
    lat: number[];
    kind: FlowNetPub["nodes"]["kind"];
    /** Index into `reservoirs`, or -1. */
    reservoir: number[];
  };
  branches: {
    from: number;
    to: number;
    kind: "channel" | "connector";
    share: number;
    flux: number | null;
    lon: number[];
    lat: number[];
    halfWidthM: number[];
  }[];
  reservoirs: {
    /** Outer ring first. */
    rings: { lon: number[]; lat: number[] }[];
    areaKm2: number;
    drift: [number, number];
    inlets: number[];
    outlets: [number, number, number | null][];
  }[];
}

/** Metres per degree of longitude and of latitude at the origin. */
export function localScale(lat0: number): { kx: number; ky: number } {
  return { kx: RAD * R * Math.cos(lat0 * RAD), ky: RAD * R };
}

export function toLocal(
  origin: readonly [number, number],
  lon: number,
  lat: number,
): [number, number] {
  const { kx, ky } = localScale(origin[1]);
  return [(lon - origin[0]) * kx, (lat - origin[1]) * ky];
}

export function fromLocal(
  origin: readonly [number, number],
  x: number,
  y: number,
): [number, number] {
  const { kx, ky } = localScale(origin[1]);
  return [origin[0] + x / kx, origin[1] + y / ky];
}

/** Delta-encoded integer metres [x0, y0, dx1, dy1, ...] of a lon/lat polyline. */
function encodeLine(
  origin: readonly [number, number],
  lon: readonly number[],
  lat: readonly number[],
): number[] {
  const out: number[] = [];
  let px = 0;
  let py = 0;
  for (let i = 0; i < lon.length; i++) {
    const [x, y] = toLocal(origin, lon[i]!, lat[i]!);
    const rx = Math.round(x);
    const ry = Math.round(y);
    out.push(rx - px, ry - py);
    px = rx;
    py = ry;
  }
  return out;
}

function decodeLine(
  origin: readonly [number, number],
  xy: readonly number[],
): { lon: number[]; lat: number[] } {
  const lon: number[] = [];
  const lat: number[] = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i + 1 < xy.length; i += 2) {
    x += xy[i]!;
    y += xy[i + 1]!;
    const [lo, la] = fromLocal(origin, x, y);
    lon.push(lo);
    lat.push(la);
  }
  return { lon, lat };
}

const deltas = (v: readonly number[]) => v.map((h, i) => h - (v[i - 1] ?? 0));
const undelta = (d: readonly number[]) => {
  let acc = 0;
  return d.map((h) => (acc += h));
};

export function encodeNet(net: FlowNet): FlowNetPub {
  const origin: [number, number] = [
    Math.round(net.bbox[0] * 1e6) / 1e6,
    Math.round(net.bbox[1] * 1e6) / 1e6,
  ];
  const nodeIdx = new Map(net.nodes.map((n, i) => [n.id, i]));
  const resIdx = new Map(net.reservoirs.map((r, i) => [r.id, i]));
  const node = (id: string) => {
    const i = nodeIdx.get(id);
    if (i === undefined) throw new Error(`unknown node ${id}`);
    return i;
  };
  const xs: number[] = [];
  const ys: number[] = [];
  for (const n of net.nodes) {
    const [x, y] = toLocal(origin, n.lon, n.lat);
    xs.push(Math.round(x));
    ys.push(Math.round(y));
  }
  return {
    schema: "flow-net-pub/1",
    id: net.id,
    region: net.region,
    origin,
    bbox: net.bbox,
    courseLengthM: Math.round(net.courseLengthM),
    source: { dates: net.source.dates, attribution: net.source.attribution },
    model: { shares: net.model.shares },
    qa: {
      wetCourseCoverage: net.qa.wetCourseCoverage,
      cycles: net.qa.cycles,
    },
    nodes: {
      x: xs,
      y: ys,
      kind: net.nodes.map((n) => n.kind),
      reservoir: net.nodes.map((n) =>
        n.reservoir === null ? -1 : (resIdx.get(n.reservoir) ?? -1),
      ),
    },
    branches: net.branches.map((b) => ({
      from: node(b.from),
      to: node(b.to),
      kind: b.kind,
      share: b.share,
      flux: b.flux,
      xy: encodeLine(origin, b.lon, b.lat),
      hw: deltas(b.halfWidthM.map((h) => Math.round(h))),
    })),
    reservoirs: net.reservoirs.map((r) => ({
      rings: r.rings.map((ring) =>
        encodeLine(
          origin,
          ring.map((p) => p[0]),
          ring.map((p) => p[1]),
        ),
      ),
      areaKm2: r.areaKm2,
      drift: [r.drift[0], r.drift[1]],
      inlets: r.inlets.map(node),
      outlets: r.outlets.map((o) => [node(o.node), o.share, o.flux]),
    })),
  };
}

export function decodeNet(pub: FlowNetPub): DecodedNet {
  const { origin } = pub;
  const lon: number[] = [];
  const lat: number[] = [];
  pub.nodes.x.forEach((x, i) => {
    const [lo, la] = fromLocal(origin, x, pub.nodes.y[i]!);
    lon.push(lo);
    lat.push(la);
  });
  return {
    id: pub.id,
    region: pub.region,
    origin: [origin[0], origin[1]],
    bbox: pub.bbox,
    courseLengthM: pub.courseLengthM,
    source: pub.source,
    model: pub.model,
    qa: pub.qa,
    nodes: { lon, lat, kind: pub.nodes.kind, reservoir: pub.nodes.reservoir },
    branches: pub.branches.map((b) => ({
      from: b.from,
      to: b.to,
      kind: b.kind,
      share: b.share,
      flux: b.flux,
      ...decodeLine(origin, b.xy),
      halfWidthM: undelta(b.hw),
    })),
    reservoirs: pub.reservoirs.map((r) => ({
      rings: r.rings.map((ring) => decodeLine(origin, ring)),
      areaKm2: r.areaKm2,
      drift: [r.drift[0], r.drift[1]],
      inlets: r.inlets,
      outlets: r.outlets,
    })),
  };
}

/** Largest distance in metres between a vertex of `net` and its decoded position. */
export function maxDecodeErrorM(net: FlowNet, dec: DecodedNet): number {
  const { kx, ky } = localScale(dec.origin[1]);
  let max = 0;
  const cmp = (
    lon: readonly number[],
    lat: readonly number[],
    dLon: readonly number[],
    dLat: readonly number[],
  ) => {
    lon.forEach((lo, i) => {
      max = Math.max(
        max,
        Math.hypot((lo - dLon[i]!) * kx, (lat[i]! - dLat[i]!) * ky),
      );
    });
  };
  cmp(
    net.nodes.map((n) => n.lon),
    net.nodes.map((n) => n.lat),
    dec.nodes.lon,
    dec.nodes.lat,
  );
  net.branches.forEach((b, i) =>
    cmp(b.lon, b.lat, dec.branches[i]!.lon, dec.branches[i]!.lat),
  );
  net.reservoirs.forEach((r, i) =>
    r.rings.forEach((ring, j) =>
      cmp(
        ring.map((p) => p[0]),
        ring.map((p) => p[1]),
        dec.reservoirs[i]!.rings[j]!.lon,
        dec.reservoirs[i]!.rings[j]!.lat,
      ),
    ),
  );
  return max;
}
