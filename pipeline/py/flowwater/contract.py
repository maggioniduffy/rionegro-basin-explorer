"""
flow-net/1 writer of the flow-water step (F2.4): serialises a Network as
data/work/<region>/flow-water/out/<sectionId>.net.json (read by the F3 particle engine, zod schema in
lib/flow/net-schema.ts) and a QA GeoJSON overlay for QGIS.

Compact JSON with a fixed key order, lon/lat to 1e-6, metres to 0.1, km2 to 0.001, share and flux to
1e-4, capacity to 0.1; two runs give the same bytes. All coordinates leave the grid CRS through pyproj
(always_xy). Shares are an illustrative display model, not a measured discharge partition.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pyproj
from shapely.geometry import LineString, Polygon
from shapely.geometry.polygon import orient

from flowwater.acquire import Stack
from flowwater.config import Config
from flowwater.network import Network, _course_extent, course_tangent, capacity
from flowwater.paths import work_dir
from flowwater.water import WaterResult

SCHEMA = "flow-net/1"
IMAGERY = "Sentinel-2 L2A (Earth Search v1)"
DEM = "Copernicus DEM GLO-30"
ATTRIBUTION = (
    "Contains modified Copernicus Sentinel data {years}; produced using Copernicus WorldDEM-30 "
    "© DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS "
    "by the European Union and ESA; all rights reserved"
)
SUM_TOL = 1e-6


def out_dir(region: str) -> Path:
    return work_dir(region) / "out"


# ---------------------------------------------------------------- rounding

def _r(x: float, nd: int) -> float:
    v = round(float(x), nd)
    return 0.0 if v == 0 else v  # no -0.0


def _rnd(a, nd: int) -> list[float]:
    return [_r(x, nd) for x in a]


def _round_shares(shares: list[float]) -> list[float]:
    """Round to 1e-4 and give the residual to the largest share, so the group sums to 1."""
    if not shares:
        return []
    out = [_r(s, 4) for s in shares]
    resid = _r(1.0 - sum(out), 4)
    if resid != 0:
        i = max(range(len(out)), key=lambda k: (out[k], -k))
        out[i] = _r(out[i] + resid, 4)
    return out


def _dedupe(lon: list[float], lat: list[float], hw: list[float] | None = None):
    keep = [0]
    for i in range(1, len(lon)):
        if (lon[i], lat[i]) != (lon[keep[-1]], lat[keep[-1]]):
            keep.append(i)
    pick = lambda a: [a[i] for i in keep]
    return (pick(lon), pick(lat), pick(hw)) if hw is not None else (pick(lon), pick(lat))


# ---------------------------------------------------------------- drift

def _unit(v) -> list[float] | None:
    n = math.hypot(v[0], v[1])
    return None if n < 1e-9 else [v[0] / n, v[1] / n]


def to_true_north(u, crs: str, x: float, y: float) -> list[float]:
    """Grid vector u = (dx, dy) at the grid point (x, y) -> unit (east, north) of the true compass.
    True north is the direction of a short step along the meridian; the grid is rotated from it by the
    meridian convergence (about (lon - central meridian) x sin(lat); EPSG:32719, central meridian -69,
    is 4 degrees off at -63)."""
    fwd = pyproj.Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
    inv = pyproj.Transformer.from_crs("EPSG:4326", crs, always_xy=True)
    lon, lat = fwd.transform(x, y)
    x2, y2 = inv.transform(lon, lat + 1e-4)  # ~11 m along the meridian
    n = _unit([x2 - x, y2 - y])
    return [u[0] * n[1] - u[1] * n[0], u[0] * n[0] + u[1] * n[1]]  # u . east, u . north


def reservoir_drift(poly: Polygon, ports_in: list, ports_out: list, course: LineString, crs: str):
    """(unit [east, north], driftFrom, sRange or None). The direction is found in the grid CRS (UTM,
    `crs`) and rotated to true east / north by the meridian convergence at the polygon centroid."""
    if course.intersects(poly):
        s0, s1 = _course_extent(course, poly)
        s_range = [s0, s1]
    else:
        s_range = None
    c = poly.centroid
    if ports_in and ports_out:
        a = np.mean([[p.x, p.y] for p in ports_in], axis=0)
        b = np.mean([[p.x, p.y] for p in ports_out], axis=0)
        u = _unit(b - a)
        if u is not None:
            return to_true_north(u, crs, c.x, c.y), "ports", s_range
    if s_range is not None and s_range[1] > s_range[0]:
        a, b = course.interpolate(s_range[0]), course.interpolate(s_range[1])
        u = _unit([b.x - a.x, b.y - a.y])
        if u is not None:
            return to_true_north(u, crs, c.x, c.y), "course", s_range
    s_near = s_range[0] if s_range is not None else course.project(poly.centroid)
    u = _unit(course_tangent(course, s_near))
    if u is None:
        raise ValueError("no drift direction: degenerate course")
    return to_true_north(u, crs, c.x, c.y), "course", s_range


# ---------------------------------------------------------------- build

def build_net(cfg: Config, region: str, stack: Stack, wr: WaterResult, net: Network) -> dict:
    tf = pyproj.Transformer.from_crs(cfg.crs, "EPSG:4326", always_xy=True)

    def ll(xy: np.ndarray) -> tuple[list[float], list[float]]:
        x, y = tf.transform(xy[:, 0], xy[:, 1])
        return _rnd(x, 6), _rnd(y, 6)

    course = LineString(stack.course_xy)
    port_res = {p.node: p.reservoir for p in net.ports}

    nodes = []
    for n in net.nodes:
        lon, lat = ll(np.array([[n.x, n.y]]))
        nodes.append({"id": n.id, "lon": lon[0], "lat": lat[0], "s": _r(n.s, 1), "kind": n.kind,
                      "reservoir": port_res.get(n.id)})
    s_of = {n.id: n.s for n in net.nodes}

    # shares of the branches leaving one node are rounded together
    by_from: dict[str, list] = {}
    for b in net.branches:
        by_from.setdefault(b.from_node, []).append(b)
    share: dict[str, float] = {}
    for grp in by_from.values():
        for b, v in zip(grp, _round_shares([b.share if b.share is not None else 1.0 for b in grp])):
            share[b.id] = v

    branches = []
    for b in net.branches:
        lon, lat = ll(b.xy)
        lon, lat, hw = _dedupe(lon, lat, _rnd(b.half_width_m, 1))
        branches.append({
            "id": b.id, "from": b.from_node, "to": b.to_node, "kind": b.kind,
            "lon": lon, "lat": lat, "halfWidthM": hw,
            "lengthM": _r(b.length_m, 1), "meanWidthM": _r(b.mean_width_m, 1),
            "capacity": _r(capacity(b.mean_width_m, cfg.network.capacity_exponent), 1),
            "share": share[b.id], "flux": None if b.flux is None else _r(b.flux, 4),
            "orient": b.orient, "narrow": bool(b.narrow),
            "s": [_r(s_of[b.from_node], 1), _r(s_of[b.to_node], 1)],
        })

    reservoirs = []
    for rid, poly in net.reservoirs:
        pin = [p for p in net.ports if p.reservoir == rid and p.role == "inlet"]
        pout = [p for p in net.ports if p.reservoir == rid and p.role == "outlet"]
        outs = _round_shares([p.share if p.share is not None else 1.0 for p in pout])
        poly = orient(poly)
        rings = []
        for ring in [poly.exterior, *poly.interiors]:
            lon, lat = _dedupe(*ll(np.asarray(ring.coords)))
            if len(lon) >= 4:
                rings.append([[x, y] for x, y in zip(lon, lat)])
        u, drift_from, s_range = reservoir_drift(poly, pin, pout, course, cfg.crs)
        reservoirs.append({
            "id": rid, "rings": rings, "areaKm2": _r(poly.area / 1e6, 3),
            "inlets": [p.node for p in pin],
            "outlets": [{"node": p.node, "share": sh, "flux": None if p.flux is None else _r(p.flux, 4)}
                        for p, sh in zip(pout, outs)],
            "drift": [_r(u[0], 4), _r(u[1], 4)], "driftFrom": drift_from,
            "sRange": None if s_range is None else _rnd(s_range, 1),
        })

    st, ws = net.stats, wr.stats
    qa = {k: st.get(k) for k in ("courseCoverage", "wetCourseCoverage", "courseInWater", "insideWater", "f1InsideWater",
                                 "cycles", "connectors", "parallelArms")}
    qa["lakeIoU"] = ws.get("lakeIoU")

    xs = [n["lon"] for n in nodes] + [x for b in branches for x in b["lon"]] \
        + [p[0] for r in reservoirs for ring in r["rings"] for p in ring]
    ys = [n["lat"] for n in nodes] + [y for b in branches for y in b["lat"]] \
        + [p[1] for r in reservoirs for ring in r["rings"] for p in ring]
    bbox = [min(xs), min(ys), max(xs), max(ys)] if xs else [0.0, 0.0, 0.0, 0.0]

    scenes = sorted({i for lk in stack.looks for i in lk.item_ids})
    dates = sorted(lk.date for lk in stack.looks)
    years = sorted({d[:4] for d in dates})
    years_txt = years[0] if len(years) == 1 else f"{years[0]}-{years[-1]}"
    return {
        "schema": SCHEMA, "id": stack.section_id, "region": region, "bbox": bbox,
        "source": {"imagery": IMAGERY, "scenes": scenes, "dates": [dates[0], dates[-1]],
                   "dem": DEM, "attribution": ATTRIBUTION.format(years=years_txt)},
        "model": {"shares": "illustrative", "capacityExponent": cfg.network.capacity_exponent},
        "courseLengthM": _r(course.length, 1),
        "nodes": nodes, "branches": branches, "reservoirs": reservoirs, "qa": qa,
    }


# ---------------------------------------------------------------- invariants

def _finite(x, path: str) -> None:
    if isinstance(x, bool) or x is None or isinstance(x, str):
        return
    if isinstance(x, (int, float)):
        if not math.isfinite(x):
            raise ValueError(f"non-finite number at {path}")
    elif isinstance(x, dict):
        for k, v in x.items():
            _finite(v, f"{path}.{k}")
    elif isinstance(x, (list, tuple)):
        for i, v in enumerate(x):
            _finite(v, f"{path}[{i}]")


def check_net(d: dict) -> None:
    """Raise ValueError on the first broken invariant."""
    _finite(d, "net")
    node_ids = [n["id"] for n in d["nodes"]]
    if len(set(node_ids)) != len(node_ids):
        raise ValueError("duplicate node ids")
    for what in ("branches", "reservoirs"):
        ids = [x["id"] for x in d[what]]
        if len(set(ids)) != len(ids):
            raise ValueError(f"duplicate {what} ids")
    nodes, res_ids = set(node_ids), {r["id"] for r in d["reservoirs"]}
    for n in d["nodes"]:
        if n["reservoir"] is not None and n["reservoir"] not in res_ids:
            raise ValueError(f"node {n['id']}: unknown reservoir {n['reservoir']}")
    out_share: dict[str, float] = {}
    for b in d["branches"]:
        if b["from"] not in nodes or b["to"] not in nodes:
            raise ValueError(f"branch {b['id']}: unknown node")
        if not (len(b["lon"]) == len(b["lat"]) == len(b["halfWidthM"]) >= 2):
            raise ValueError(f"branch {b['id']}: arrays differ in length or hold < 2 vertices")
        out_share[b["from"]] = out_share.get(b["from"], 0.0) + b["share"]
    for n, tot in out_share.items():
        if abs(tot - 1.0) > SUM_TOL:
            raise ValueError(f"node {n}: branch shares sum to {tot}")
    for r in d["reservoirs"]:
        if not r["rings"]:
            raise ValueError(f"reservoir {r['id']}: no rings")
        for ref in [*r["inlets"], *(o["node"] for o in r["outlets"])]:
            if ref not in nodes:
                raise ValueError(f"reservoir {r['id']}: unknown node {ref}")
        if r["outlets"] and abs(sum(o["share"] for o in r["outlets"]) - 1.0) > SUM_TOL:
            raise ValueError(f"reservoir {r['id']}: outlet shares do not sum to 1")


# ---------------------------------------------------------------- QA overlay

def qa_geojson(d: dict, course_ll: tuple[list[float], list[float]]) -> dict:
    feats = []
    for r in d["reservoirs"]:
        feats.append({"type": "Feature",
                      "properties": {"layer": "reservoir", "id": r["id"], "areaKm2": r["areaKm2"]},
                      "geometry": {"type": "Polygon", "coordinates": r["rings"]}})
    for b in d["branches"]:
        feats.append({"type": "Feature",
                      "properties": {"layer": "branch", "id": b["id"], "kind": b["kind"],
                                     "meanWidthM": b["meanWidthM"], "share": b["share"],
                                     "flux": b["flux"], "orient": b["orient"], "narrow": b["narrow"]},
                      "geometry": {"type": "LineString",
                                   "coordinates": [[x, y] for x, y in zip(b["lon"], b["lat"])]}})
    for n in d["nodes"]:
        feats.append({"type": "Feature",
                      "properties": {"layer": "node", "id": n["id"], "kind": n["kind"]},
                      "geometry": {"type": "Point", "coordinates": [n["lon"], n["lat"]]}})
    feats.append({"type": "Feature", "properties": {"layer": "course"},
                  "geometry": {"type": "LineString",
                               "coordinates": [[x, y] for x, y in zip(*course_ll)]}})
    return {"type": "FeatureCollection", "features": feats}


def _dump(obj) -> bytes:
    return (json.dumps(obj, separators=(",", ":"), ensure_ascii=False, allow_nan=False) + "\n").encode()


def _write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_bytes(data)
    tmp.replace(path)


def write_section(cfg: Config, region: str, stack: Stack, wr: WaterResult, net: Network) -> dict:
    """Write <id>.net.json and <id>.qa.geojson; returns {netBytes, qaBytes}. Raises ValueError when an
    invariant fails (nothing is written then)."""
    d = build_net(cfg, region, stack, wr, net)
    check_net(d)
    tf = pyproj.Transformer.from_crs(cfg.crs, "EPSG:4326", always_xy=True)
    x, y = tf.transform(stack.course_xy[:, 0], stack.course_xy[:, 1])
    net_b = _dump(d)
    qa_b = _dump(qa_geojson(d, (_rnd(x, 6), _rnd(y, 6))))
    out = out_dir(region)
    _write(out / f"{stack.section_id}.net.json", net_b)
    _write(out / f"{stack.section_id}.qa.geojson", qa_b)
    return {"netBytes": len(net_b), "qaBytes": len(qa_b)}
