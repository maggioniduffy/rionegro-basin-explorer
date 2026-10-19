import {
  FLOW_RESERVOIR_OUTLET_HW_FACTOR,
  FLOW_RESERVOIR_OUTLET_MIN_M,
  FLOW_RESERVOIR_SEED_SHARE,
} from "./config";
import {
  buildTrackFromLine,
  lngLatToMercator,
  meanWidth,
  metresToMercator,
  type Track,
} from "./geometry";
import { decodeNet } from "./net-pub";
import type { FlowNetPub } from "./net-pub-schema";
import { branchSpeedFactor } from "./speed";

/**
 * Runtime form of a published flow network (flow-net-pub/1, see net-pub-schema.ts), ready for
 * the particle engine (createNetParticles / stepNetParticles in particles.ts).
 *
 * Frame: everything is Web Mercator units (x east, y SOUTH), relative to ONE shared origin
 * (Mercator of `pub.origin`), so branch tracks, node positions and reservoir rings can be
 * mixed freely. Each branch is a `Track` with originX/Y = that origin and a symmetric channel
 * (nMin = -halfWidthM, nMax = +halfWidthM). Typed arrays are indexed by branch or node index.
 *
 * - Out-branches of node n: outBranch[outStart[n] .. outStart[n+1]), with cumulative shares
 *   outCum (normalised to end at 1; equal shares if they all are 0).
 * - nodeInlet[n]: reservoir index if n is an inlet of that reservoir, else -1.
 * - Speed: see branchSpeed (speed.ts); useFlux is false (width ratio only) unless every
 *   branch has a flux.
 * - Seeding: seedCum is the cumulative probability over branches (0..B-1) then reservoirs
 *   (B..B+R-1), ending at 1 (empty when there is nothing to seed). Branches weigh
 *   length x flux (length x share when no flux), reservoirs together FLOW_RESERVOIR_SEED_SHARE
 *   split by area; only reservoirs (or only branches) get everything.
 */

export interface NetOutlet {
  node: number;
  x: number;
  y: number;
  share: number;
  flux: number | null;
  /** Squared hand-off radius in Mercator units. */
  radius2: number;
  /** flux > 0 (or share > 0 when flux is null) and the node has out-branches. */
  open: boolean;
}

export interface NetReservoir {
  /** Outer ring first, then holes; origin-relative Mercator coordinates. */
  ringX: Float64Array[];
  ringY: Float64Array[];
  bbox: [number, number, number, number];
  areaKm2: number;
  /** Unit drift in the Mercator frame (y grows south, so north is -y). */
  driftX: number;
  driftY: number;
  /** Mercator units per metre in the reservoir. */
  mPerUnit: number;
  inlets: number[];
  outlets: NetOutlet[];
  /** Point used when rejection sampling fails. */
  /** A point known to be inside the polygon (anchor for sampling fallback and recovery). */
  fallbackX: number;
  fallbackY: number;
}

export interface FlowNetwork {
  id: string;
  originX: number;
  originY: number;
  tracks: Track[];
  branchFrom: Int32Array;
  branchTo: Int32Array;
  branchMeanW: Float64Array;
  /** Flux per branch (0 where null; only meaningful when useFlux). */
  branchFlux: Float64Array;
  useFlux: boolean;
  /** Largest unnormalised branch speed factor (u = 0, over the vertices). */
  speedNorm: number;
  nodeX: Float64Array;
  nodeY: Float64Array;
  nodeKind: string[];
  nodeReservoir: Int32Array;
  nodeInlet: Int32Array;
  /** Where a particle enters the node's reservoir: the node, or the nearest point inside the polygon. */
  nodeEntryX: Float64Array;
  nodeEntryY: Float64Array;
  outStart: Int32Array;
  outBranch: Int32Array;
  outCum: Float64Array;
  reservoirs: NetReservoir[];
  seedCum: Float64Array;
}

export function buildNetwork(pub: FlowNetPub): FlowNetwork {
  const dec = decodeNet(pub);
  const [originX, originY] = lngLatToMercator(dec.origin[0], dec.origin[1]);
  const origin: [number, number] = [originX, originY];
  const nNodes = dec.nodes.lon.length;
  const nB = dec.branches.length;

  const tracks = dec.branches.map((b) =>
    buildTrackFromLine(
      b.lon,
      b.lat,
      b.halfWidthM.map((h) => -h),
      b.halfWidthM,
      origin,
    ),
  );
  const branchFrom = new Int32Array(nB);
  const branchTo = new Int32Array(nB);
  const branchMeanW = new Float64Array(nB);
  const branchFlux = new Float64Array(nB);
  dec.branches.forEach((b, i) => {
    branchFrom[i] = b.from;
    branchTo[i] = b.to;
    branchMeanW[i] = meanWidth(tracks[i]!);
    branchFlux[i] = b.flux ?? 0;
  });
  const useFlux = nB > 0 && dec.branches.every((b) => b.flux !== null);

  let speedNorm = 0;
  for (let b = 0; b < nB; b++) {
    const t = tracks[b]!;
    for (let i = 0; i < t.s.length; i++) {
      const f = branchSpeedFactor(
        t,
        branchMeanW[b]!,
        branchFlux[b]!,
        useFlux,
        t.s[i]!,
      );
      if (f > speedNorm) speedNorm = f;
    }
  }
  if (speedNorm <= 0) speedNorm = 1;

  const nodeX = new Float64Array(nNodes);
  const nodeY = new Float64Array(nNodes);
  for (let i = 0; i < nNodes; i++) {
    const [mx, my] = lngLatToMercator(dec.nodes.lon[i]!, dec.nodes.lat[i]!);
    nodeX[i] = mx - originX;
    nodeY[i] = my - originY;
  }

  // Out-branch lists with cumulative shares.
  const outStart = new Int32Array(nNodes + 1);
  for (const b of dec.branches)
    outStart[b.from + 1] = outStart[b.from + 1]! + 1;
  for (let i = 0; i < nNodes; i++)
    outStart[i + 1] = outStart[i + 1]! + outStart[i]!;
  const fill = outStart.slice(0, nNodes);
  const outBranch = new Int32Array(nB);
  dec.branches.forEach((b, i) => {
    outBranch[fill[b.from]!] = i;
    fill[b.from] = fill[b.from]! + 1;
  });
  const outCum = new Float64Array(nB);
  for (let n = 0; n < nNodes; n++) {
    const a = outStart[n]!;
    const z = outStart[n + 1]!;
    let total = 0;
    for (let k = a; k < z; k++)
      total += Math.max(0, dec.branches[outBranch[k]!]!.share);
    let acc = 0;
    for (let k = a; k < z; k++) {
      acc += total > 0 ? Math.max(0, dec.branches[outBranch[k]!]!.share) : 1;
      outCum[k] = acc / (total > 0 ? total : z - a);
    }
  }

  const nodeInlet = new Int32Array(nNodes).fill(-1);
  const nodeEntryX = nodeX.slice();
  const nodeEntryY = nodeY.slice();
  const reservoirs: NetReservoir[] = dec.reservoirs.map((r, ri) => {
    r.inlets.forEach((n) => {
      nodeInlet[n] = ri;
    });
    const ringX: Float64Array[] = [];
    const ringY: Float64Array[] = [];
    const bbox: [number, number, number, number] = [
      Infinity,
      Infinity,
      -Infinity,
      -Infinity,
    ];
    let latSum = 0;
    let latN = 0;
    r.rings.forEach((ring, k) => {
      const xs = new Float64Array(ring.lon.length);
      const ys = new Float64Array(ring.lon.length);
      for (let i = 0; i < xs.length; i++) {
        const [mx, my] = lngLatToMercator(ring.lon[i]!, ring.lat[i]!);
        xs[i] = mx - originX;
        ys[i] = my - originY;
        if (k === 0) {
          bbox[0] = Math.min(bbox[0], xs[i]!);
          bbox[1] = Math.min(bbox[1], ys[i]!);
          bbox[2] = Math.max(bbox[2], xs[i]!);
          bbox[3] = Math.max(bbox[3], ys[i]!);
          latSum += ring.lat[i]!;
          latN++;
        }
      }
      ringX.push(xs);
      ringY.push(ys);
    });
    const mPerUnit = metresToMercator(latN > 0 ? latSum / latN : dec.origin[1]);
    // [east, north] -> Mercator (north is -y), normalised.
    const dl = Math.hypot(r.drift[0], r.drift[1]);
    const driftX = dl > 0 ? r.drift[0] / dl : 0;
    const driftY = dl > 0 ? -r.drift[1] / dl : 0;
    const outlets: NetOutlet[] = r.outlets.map(([node, share, flux]) => {
      let hw = 0;
      for (let k = outStart[node]!; k < outStart[node + 1]!; k++)
        hw = Math.max(hw, dec.branches[outBranch[k]!]!.halfWidthM[0] ?? 0);
      const radiusM = Math.max(
        FLOW_RESERVOIR_OUTLET_MIN_M,
        FLOW_RESERVOIR_OUTLET_HW_FACTOR * hw,
      );
      const hasOut = outStart[node + 1]! > outStart[node]!;
      return {
        node,
        x: nodeX[node]!,
        y: nodeY[node]!,
        share,
        flux,
        radius2: (radiusM * mPerUnit) ** 2,
        open: hasOut && (flux === null ? share > 0 : flux > 0),
      };
    });
    const res: NetReservoir = {
      ringX,
      ringY,
      bbox,
      areaKm2: r.areaKm2,
      driftX,
      driftY,
      mPerUnit,
      inlets: r.inlets,
      outlets,
      fallbackX: (bbox[0] + bbox[2]) / 2,
      fallbackY: (bbox[1] + bbox[3]) / 2,
    };
    const inside = insidePoint(res);
    res.fallbackX = inside[0];
    res.fallbackY = inside[1];
    for (const n of r.inlets) {
      const e = entryPoint(res, nodeX[n]!, nodeY[n]!);
      nodeEntryX[n] = e[0];
      nodeEntryY[n] = e[1];
    }
    return res;
  });

  // Seeding weights.
  const bw = tracks.map((t, i) => {
    const w = useFlux ? branchFlux[i]! : Math.max(0, dec.branches[i]!.share);
    return t.length * Math.max(0, w);
  });
  const bTotal = bw.reduce((a, b) => a + b, 0);
  const areas = reservoirs.map((r) => Math.max(0, r.areaKm2));
  const aTotal = areas.reduce((a, b) => a + b, 0);
  const rShare =
    aTotal > 0 && bTotal > 0 ? FLOW_RESERVOIR_SEED_SHARE : aTotal > 0 ? 1 : 0;
  const weights = [
    ...bw.map((w) => (bTotal > 0 ? ((1 - rShare) * w) / bTotal : 0)),
    ...areas.map((a) => (aTotal > 0 ? (rShare * a) / aTotal : 0)),
  ];
  const wTotal = weights.reduce((a, b) => a + b, 0);
  const seedCum = new Float64Array(wTotal > 0 ? weights.length : 0);
  let acc = 0;
  for (let i = 0; i < seedCum.length; i++) {
    acc += weights[i]! / wTotal;
    seedCum[i] = acc;
  }

  return {
    id: dec.id,
    originX,
    originY,
    tracks,
    branchFrom,
    branchTo,
    branchMeanW,
    branchFlux,
    useFlux,
    speedNorm,
    nodeX,
    nodeY,
    nodeKind: dec.nodes.kind,
    nodeReservoir: Int32Array.from(dec.nodes.reservoir),
    nodeInlet,
    nodeEntryX,
    nodeEntryY,
    outStart,
    outBranch,
    outCum,
    reservoirs,
    seedCum,
  };
}

/** Even-odd point in polygon over all rings (outer + holes), so holes are excluded. */
export function insideReservoir(
  r: NetReservoir,
  px: number,
  py: number,
): boolean {
  const b = r.bbox;
  if (px < b[0] || px > b[2] || py < b[1] || py > b[3]) return false;
  let inside = false;
  for (let k = 0; k < r.ringX.length; k++) {
    const xs = r.ringX[k]!;
    const ys = r.ringY[k]!;
    for (let i = 0, j = xs.length - 1; i < xs.length; j = i++) {
      if (
        ys[i]! > py !== ys[j]! > py &&
        px < ((xs[j]! - xs[i]!) * (py - ys[i]!)) / (ys[j]! - ys[i]!) + xs[i]!
      )
        inside = !inside;
    }
  }
  return inside;
}

/** Build-time: a point inside the polygon (first hit of a bbox grid scan, else the bbox centre). */
function insidePoint(r: NetReservoir): [number, number] {
  const b = r.bbox;
  const cx = (b[0] + b[2]) / 2;
  const cy = (b[1] + b[3]) / 2;
  if (insideReservoir(r, cx, cy)) return [cx, cy];
  const N = 24;
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) {
      const x = b[0] + ((i + 0.5) / N) * (b[2] - b[0]);
      const y = b[1] + ((j + 0.5) / N) * (b[3] - b[1]);
      if (insideReservoir(r, x, y)) return [x, y];
    }
  return [cx, cy];
}

/** Metres past the boundary an entering particle is placed (tried in order). */
const ENTRY_MARGINS_M = [3, 6, 12, 25, 50];

/**
 * Build-time: where a particle entering at (px, py) starts. The point itself when inside; else
 * the nearest boundary point moved inward by a small margin (the direction from the node to
 * the boundary, then its opposite), else stepping from the boundary toward an inside point.
 */
function entryPoint(r: NetReservoir, px: number, py: number): [number, number] {
  if (insideReservoir(r, px, py)) return [px, py];
  let best = Infinity;
  let qx = px;
  let qy = py;
  for (let k = 0; k < r.ringX.length; k++) {
    const xs = r.ringX[k]!;
    const ys = r.ringY[k]!;
    for (let i = 0; i + 1 < xs.length; i++) {
      const ax = xs[i]!;
      const ay = ys[i]!;
      const bx = xs[i + 1]! - ax;
      const by = ys[i + 1]! - ay;
      const len2 = bx * bx + by * by;
      const t =
        len2 > 0
          ? Math.min(1, Math.max(0, ((px - ax) * bx + (py - ay) * by) / len2))
          : 0;
      const x = ax + bx * t;
      const y = ay + by * t;
      const d2 = (px - x) ** 2 + (py - y) ** 2;
      if (d2 < best) {
        best = d2;
        qx = x;
        qy = y;
      }
    }
  }
  const dl = Math.sqrt(best);
  if (dl > 0) {
    const dx = (qx - px) / dl;
    const dy = (qy - py) / dl;
    for (const sign of [1, -1])
      for (const m of ENTRY_MARGINS_M) {
        const x = qx + sign * dx * m * r.mPerUnit;
        const y = qy + sign * dy * m * r.mPerUnit;
        if (insideReservoir(r, x, y)) return [x, y];
      }
  }
  for (let f = 0.05; f <= 1.0001; f += 0.05) {
    const x = qx + (r.fallbackX - qx) * f;
    const y = qy + (r.fallbackY - qy) * f;
    if (insideReservoir(r, x, y)) return [x, y];
  }
  return [r.fallbackX, r.fallbackY];
}
