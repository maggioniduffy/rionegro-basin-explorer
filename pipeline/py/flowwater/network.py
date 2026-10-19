"""
Water network of the flow-water step (F2.3): from the channel mask of a WaterResult, a directed
multi-branch network with reservoirs as hubs, dam connectors, flow shares and flux.

1. Skeleton of the water mask restricted to the channel (the reservoir zone is part of the
   skeletonised area so channel ends reach the zone instead of retracting from it), read with skan
   into an nx.MultiGraph (parallel arms around an island stay two edges). Adjacent junction pixels
   are contracted into one node; self-loops (a ring hanging on one node) are dropped.
2. Prune to a fixed point: spurs (terminal branches shorter than the larger of spurMinPx pixels and
   spurWidthFactor x the junction width, unless the free end is protected), then branches narrower
   than minBranchWidthM (unless they alone link protected ends), then short components.
3. Chainage s of every node along the IGN course. Free ends touching a reservoir zone become ports of
   its polygon (the hub). A course-following stub (a free end inside the grid whose branch follows the
   course for at least minComponentM) is first connected along the course across a dry gap of at most
   connectorMaxM to the next reservoir or free end, then dead ends are pruned. Flow components (graph +
   hubs) separated along the course by less than connectorMaxM are bridged by a flagged connector; wider
   gaps are reported.
4. Orientation per edge: course chainage, else the GLO-30 drop, else the course tangent. Capacity =
   mean width ** capacityExponent; share = capacity / sum over the out-edges of a node; flux flows
   from the sources (total 1) in topological order. A reservoir is two hubs, res:<id>:in (ports whose
   branch flows into it) and res:<id>:out; the flux of the in hub passes to the out hub. Shares and flux
   are an illustrative display model, not a measured discharge partition.
5. Geometry: pixel paths are Chaikin-smoothed and simplified, with a half width per vertex.
"""

from __future__ import annotations

import itertools
import logging
import math
from dataclasses import dataclass, field
from typing import Callable

import networkx as nx
import numpy as np
import shapely
from affine import Affine
from scipy import ndimage
from shapely.geometry import LineString, MultiLineString, Point, Polygon
from shapely.ops import nearest_points, substring, unary_union
from skan import Skeleton
from skimage.morphology import skeletonize

from flowwater.acquire import Stack
from flowwater.config import Config, NetworkConfig
from flowwater.water import WaterResult

log = logging.getLogger("flowwater")

EIGHT = np.ones((3, 3), bool)
BORDER_PX = 3  # a free end this close to the grid border may be where the river enters or leaves
SKEL_PAD = 40  # px of edge padding so the skeleton runs to the grid border
MAX_CYCLES = 1000


@dataclass
class NetNode:
    id: str
    kind: str  # source, sink, port, split, join, pass
    x: float
    y: float
    s: float  # chainage along the course, m


@dataclass
class NetBranch:
    id: str
    kind: str  # channel or connector
    from_node: str
    to_node: str
    xy: np.ndarray  # (N, 2) grid CRS, from -> to
    half_width_m: np.ndarray  # (N,)
    mean_width_m: float
    length_m: float
    share: float | None  # None when the network has cycles
    flux: float | None
    orient: str  # course, dem, tangent
    narrow: bool


@dataclass
class NetPort:
    reservoir: str
    node: str
    role: str  # inlet or outlet
    x: float
    y: float
    share: float | None  # share of the hub -> port edge (outlets), 1 for inlets
    flux: float | None


@dataclass
class Network:
    nodes: list[NetNode]
    branches: list[NetBranch]
    ports: list[NetPort]
    reservoirs: list[tuple[str, Polygon]]
    stats: dict = field(default_factory=dict)


@dataclass
class Guards:
    """Position (row, col) predicates: `zone` near a reservoir zone, `free` where the river
    enters or leaves the grid."""
    zone: Callable[[np.ndarray], bool] = lambda p: False
    free: Callable[[np.ndarray], bool] = lambda p: False

    def protected(self, pos) -> bool:
        return self.zone(pos) or self.free(pos)


# ---------------------------------------------------------------- pixel paths

def path_len_m(path: np.ndarray, res_m: float) -> float:
    if len(path) < 2:
        return 0.0
    d = np.diff(path, axis=0)
    return float(np.hypot(d[:, 0], d[:, 1]).sum() * res_m)


def width_grid(edt_m: np.ndarray, res_m: float) -> np.ndarray:
    """River width at a pixel, m. The EDT runs from a pixel centre to the nearest dry pixel centre,
    so a strip of n pixels has a centre EDT of (n + 1) / 2 pixels and width 2 * EDT - res = n * res."""
    return np.maximum(2.0 * edt_m - res_m, res_m).astype(np.float32)


def half_width_grid(edt_m: np.ndarray, res_m: float) -> np.ndarray:
    return np.maximum(edt_m - res_m / 2.0, res_m / 2.0).astype(np.float32)


def along_course(course: LineString, t: Affine, tol_m: float) -> Callable[[np.ndarray], float]:
    """Metres of a (row, col) pixel path whose segments lie within tol_m of the course."""
    def along(path: np.ndarray) -> float:
        if len(path) < 2:
            return 0.0
        xy = rc_to_xy(path, t)
        mid = (xy[1:] + xy[:-1]) / 2.0
        seg = np.hypot(*np.diff(xy, axis=0).T)
        near = shapely.distance(shapely.points(mid), course) <= tol_m
        return float(seg[near].sum())
    return along


def path_widths(path: np.ndarray, width_m: np.ndarray) -> np.ndarray:
    r = np.clip(np.rint(path[:, 0]).astype(int), 0, width_m.shape[0] - 1)
    c = np.clip(np.rint(path[:, 1]).astype(int), 0, width_m.shape[1] - 1)
    return width_m[r, c]


def _oriented(d: dict, start: int) -> np.ndarray:
    """Edge path as a (row, col) array starting at node `start`."""
    return d["path"] if d["a"] == start else d["path"][::-1]


def _dedupe(path: np.ndarray) -> np.ndarray:
    if len(path) < 2:
        return path
    keep = np.concatenate([[True], np.any(np.diff(path, axis=0) != 0, axis=1)])
    return path[keep]


# ---------------------------------------------------------------- graph from a skeleton

def skeletonise(channel: np.ndarray, water: np.ndarray) -> np.ndarray:
    """Skeleton of the water mask (edge-padded, so it reaches the grid border) kept on the channel.
    Skeletonising the channel alone retracts its ends from the reservoir zone it ends in."""
    src = water | channel
    sk = skeletonize(np.pad(src, SKEL_PAD, mode="edge"))[SKEL_PAD:-SKEL_PAD, SKEL_PAD:-SKEL_PAD]
    return sk & channel


def build_multigraph(skel: np.ndarray) -> nx.MultiGraph:
    """MultiGraph of a skeleton: nodes int ids with `pos` (row, col); edges `path` (float row/col
    pixels, from node `a` to node `b`) and kind 'channel'. Junction clusters are contracted."""
    G = nx.MultiGraph()
    if not skel.any():
        return G
    sk = Skeleton(skel)
    paths = [sk.path_coordinates(i).astype(float) for i in range(sk.n_paths)]
    ends = [(tuple(p[0]), tuple(p[-1])) for p in paths]
    deg: dict[tuple, int] = {}
    for a, b in ends:
        deg[a] = deg.get(a, 0) + 1
        deg[b] = deg.get(b, 0) + 1
    parent = {p: p for p in deg}

    def find(p):
        while parent[p] != p:
            parent[p] = parent[parent[p]]
            p = parent[p]
        return p

    contracted = set()
    for i, ((a, b), p) in enumerate(zip(ends, paths)):
        if a != b and deg[a] >= 3 and deg[b] >= 3 and path_len_m(p, 1.0) < 2.0:
            ra, rb = find(a), find(b)
            parent[max(ra, rb)] = min(ra, rb)
            contracted.add(i)
    members: dict[tuple, list] = {}
    for p in sorted(deg):
        members.setdefault(find(p), []).append(p)
    ids = {root: n for n, root in enumerate(sorted(members))}
    for root, n in ids.items():
        G.add_node(n, pos=np.mean(members[root], axis=0))
    for i, ((a, b), p) in enumerate(zip(ends, paths)):
        if i in contracted:
            continue
        u, v = ids[find(a)], ids[find(b)]
        G.add_edge(u, v, path=p, a=u, b=v, kind="channel", narrow=False)
    return G


def drop_self_loops(G: nx.MultiGraph) -> int:
    """Drop every self-loop (a ring hanging on one node carries no through-flow); counted in
    G.graph['selfLoops']."""
    loops = [(u, v, k) for u, v, k in G.edges(keys=True) if u == v]
    G.remove_edges_from(loops)
    G.graph["selfLoops"] = G.graph.get("selfLoops", 0) + len(loops)
    return len(loops)


def merge_degree2(G: nx.MultiGraph) -> None:
    """Replace every degree-2 node joining two different neighbours by one edge (pixel order kept).
    A node on a connector is kept, so the connector stays a flagged branch."""
    for u in sorted(G.nodes):
        if u not in G or G.degree(u) != 2:
            continue
        inc = list(G.edges(u, keys=True, data=True))
        if len(inc) != 2 or any(a == b for a, b, _, _ in inc):
            continue
        (_, p, k1, d1), (_, q, k2, d2) = inc
        if "connector" in (d1["kind"], d2["kind"]):
            continue
        if p == q:
            continue  # the two arms of a loop hanging on one node
        path = _dedupe(np.concatenate([_oriented(d1, p), _oriented(d2, u)]))
        narrow = d1.get("narrow", False) or d2.get("narrow", False)
        G.remove_node(u)
        G.add_edge(p, q, path=path, a=p, b=q, kind="channel", narrow=narrow)


def normalize(G: nx.MultiGraph) -> None:
    G.remove_nodes_from([n for n in list(G.nodes) if G.degree(n) == 0])
    drop_self_loops(G)
    G.remove_nodes_from([n for n in list(G.nodes) if G.degree(n) == 0])
    merge_degree2(G)


# ---------------------------------------------------------------- pruning

def prune_spurs_pass(G, res_m, width_m, guards: Guards, nc: NetworkConfig) -> int:
    """Remove the shortest spur of every junction; returns the number removed."""
    cand: dict[int, tuple] = {}
    for u, v, k, d in G.edges(keys=True, data=True):
        if u == v or (G.degree(u) == 1) == (G.degree(v) == 1):
            continue
        t, j = (u, v) if G.degree(u) == 1 else (v, u)
        if guards.protected(G.nodes[t]["pos"]):
            continue
        p = _oriented(d, j)
        length = path_len_m(p, res_m)
        wj = float(path_widths(p[:1], width_m)[0])
        if length < max(nc.spur_min_px * res_m, nc.spur_width_factor * wj):
            key = (length, t, u, v, k)
            if j not in cand or key < cand[j]:
                cand[j] = key
    for j in sorted(cand):
        _, t, u, v, k = cand[j]
        G.remove_edge(u, v, k)
        G.remove_node(t)
    return len(cand)


def _side_has_protected(G, start, guards: Guards) -> bool:
    return any(G.degree(n) == 1 and guards.protected(G.nodes[n]["pos"])
               for n in nx.node_connected_component(G, start))


def narrow_pass(G, width_m, guards: Guards, nc: NetworkConfig) -> int:
    """Remove edges with a median width under minBranchWidthM, narrowest first, unless the edge is
    a bridge with protected free ends on both sides (then it is kept and flagged narrow)."""
    narrow = []
    for u, v, k, d in G.edges(keys=True, data=True):
        w = float(np.median(path_widths(d["path"], width_m)))
        if w < nc.min_branch_width_m and not d["narrow"]:
            narrow.append((w, u, v, k))
    removed = 0
    for _, u, v, k in sorted(narrow):
        d = G.edges[u, v, k]
        G.remove_edge(u, v, k)
        if nx.has_path(G, u, v):
            removed += 1
            continue
        if _side_has_protected(G, u, guards) and _side_has_protected(G, v, guards):
            G.add_edge(u, v, key=k, **d)
            G.edges[u, v, k]["narrow"] = True
        else:
            removed += 1
    return removed


def drop_small_components(G, res_m, guards: Guards, nc: NetworkConfig) -> int:
    n = 0
    for comp in sorted(nx.connected_components(G), key=min):
        sub = G.subgraph(comp)
        length = sum(path_len_m(d["path"], res_m) for _, _, d in sub.edges(data=True))
        has_port = any(G.degree(x) == 1 and guards.zone(G.nodes[x]["pos"]) for x in comp)
        if length < nc.min_component_m and not has_port:
            G.remove_nodes_from(comp)
            n += 1
    return n


def clean_graph(G, res_m, width_m, guards: Guards, nc: NetworkConfig) -> dict:
    """Prune to a fixed point; returns the counters of the QA."""
    st = {"prunedSpurs": 0, "droppedNarrow": 0, "droppedComponents": 0}
    normalize(G)
    while True:
        changed = 0
        while True:
            n = prune_spurs_pass(G, res_m, width_m, guards, nc)
            normalize(G)
            st["prunedSpurs"] += n
            changed += n
            if not n:
                break
        n = narrow_pass(G, width_m, guards, nc)
        normalize(G)
        st["droppedNarrow"] += n
        changed += n
        if not changed:
            break
    st["droppedComponents"] = drop_small_components(G, res_m, guards, nc)
    normalize(G)
    st["keptNarrow"] = sum(bool(d["narrow"]) for _, _, d in G.edges(data=True))
    return st


def prune_core(G, res_m: float, is_border: Callable[[np.ndarray], bool],
               term_hubs: frozenset | set = frozenset(),
               along: Callable[[np.ndarray], float] = lambda p: 0.0, keep_m: float = 0.0) -> dict:
    """Keep only the flow-bearing core: drop slivers (branches with both ends ports of one
    reservoir, and whole components attached to a single reservoir that hold no terminal; either is
    kept when at least keep_m of its branch length follows the course, per `along`), components with
    no terminal and no port, and then, to a fixed point, every free end that is not a terminal (`is_border`: a grid-border or
    course-end free end; or a hub in `term_hubs`), whatever its length. Hubs join their ports (`res` node
    attribute); loops (islands) and paths between terminals survive. Returns the counters."""
    st = {"deadEnds": 0, "deadEndsKm": 0.0, "slivers": 0, "sliversKm": 0.0}

    def drop(u, v, k, key):
        st[key] += 1
        st[key + "Km"] += path_len_m(G.edges[u, v, k]["path"], res_m) / 1000.0
        G.remove_edge(u, v, k)

    normalize(G)
    while True:
        changed = False
        for u, v, k, d in list(G.edges(keys=True, data=True)):
            r = G.nodes[u].get("res")
            if u != v and r is not None and r == G.nodes[v].get("res") and along(d["path"]) < keep_m:
                drop(u, v, k, "slivers")
                changed = True
        for comp in sorted(nx.connected_components(G), key=min):
            hubs = {G.nodes[n]["res"] for n in comp if "res" in G.nodes[n]}
            free = any(G.degree(n) == 1 and "res" not in G.nodes[n] and is_border(G.nodes[n]["pos"])
                       for n in comp)
            edges = list(G.subgraph(comp).edges(keys=True))
            if len(hubs) == 1 and not free and sum(along(G.edges[e]["path"]) for e in edges) < keep_m:
                for u, v, k in edges:
                    drop(u, v, k, "slivers")
                changed = True
            elif not hubs and not free:  # no hub and no terminal: a ring or an island of water
                for u, v, k in edges:
                    drop(u, v, k, "deadEnds")
                changed = True
        ports: dict[str, list] = {}
        for n in sorted(G.nodes):
            if "res" in G.nodes[n]:
                ports.setdefault(G.nodes[n]["res"], []).append(n)
        for n in sorted(G.nodes):
            if n not in G:
                continue
            nd = G.nodes[n]
            if "res" in nd and G.degree(n) == 0:
                G.remove_node(n)
                changed = True
            elif "res" not in nd and G.degree(n) == 1 and not is_border(nd["pos"]):
                u, v, k = next(iter(G.edges(n, keys=True)))
                drop(u, v, k, "deadEnds")
                G.remove_node(n)
                changed = True
        for h, ns in sorted(ports.items()):
            live = [n for n in ns if n in G]
            if len(live) == 1 and h not in term_hubs and G.degree(live[0]) == 1:
                u, v, k = next(iter(G.edges(live[0], keys=True)))
                drop(u, v, k, "deadEnds")
                changed = True
        before = (G.number_of_nodes(), G.number_of_edges())
        normalize(G)
        if not changed and before == (G.number_of_nodes(), G.number_of_edges()):
            return st


# ---------------------------------------------------------------- grid <-> world

def rc_to_xy(rc: np.ndarray, t: Affine) -> np.ndarray:
    """(row, col) pixel-centre positions -> grid CRS."""
    u, v = rc[:, 1] + 0.5, rc[:, 0] + 0.5
    return np.column_stack([t.a * u + t.b * v + t.c, t.d * u + t.e * v + t.f])


def xy_to_rc(xy: np.ndarray, t: Affine) -> np.ndarray:
    inv = ~t
    u = inv.a * xy[:, 0] + inv.b * xy[:, 1] + inv.c
    v = inv.d * xy[:, 0] + inv.e * xy[:, 1] + inv.f
    return np.column_stack([v - 0.5, u - 0.5])


def _pix(rc: np.ndarray, shape) -> tuple[np.ndarray, np.ndarray]:
    r = np.clip(np.floor(rc[:, 0] + 0.5).astype(int), 0, shape[0] - 1)
    c = np.clip(np.floor(rc[:, 1] + 0.5).astype(int), 0, shape[1] - 1)
    return r, c


# ---------------------------------------------------------------- orientation

def course_tangent(course: LineString, s: float) -> np.ndarray:
    a = course.interpolate(max(s - 5.0, 0.0))
    b = course.interpolate(min(s + 5.0, course.length))
    v = np.array([b.x - a.x, b.y - a.y])
    n = np.hypot(*v)
    return v / n if n > 0 else v


def orient_edge(course: LineString, a_xy, b_xy, mid_xy, z_a: float, z_b: float,
                nc: NetworkConfig) -> tuple[bool, str]:
    """(flip, how) for an edge from a to b: flip when the flow runs b -> a.
    course: chainage when the ends are orientMinM apart along the course; dem: high to low when
    both elevations are finite and differ by demMinDropM; tangent: edge vector . course tangent."""
    s_a = course.project(Point(a_xy))
    s_b = course.project(Point(b_xy))
    if abs(s_b - s_a) >= nc.orient_min_m:
        return s_b < s_a, "course"
    if math.isfinite(z_a) and math.isfinite(z_b) and abs(z_a - z_b) >= nc.dem_min_drop_m:
        return z_b > z_a, "dem"
    s_m = course.project(Point(mid_xy))
    dot = float(np.dot(np.asarray(b_xy, float) - np.asarray(a_xy, float), course_tangent(course, s_m)))
    return dot < 0, "tangent"


def _dem_at(dem: np.ndarray, pos) -> float:
    r, c = int(round(pos[0])), int(round(pos[1]))
    win = dem[max(r - 1, 0): r + 2, max(c - 1, 0): c + 2]
    return float(np.nanmean(win)) if win.size and np.isfinite(win).any() else float("nan")


# ---------------------------------------------------------------- shares and flux

def capacity(width_m: float, exponent: float) -> float:
    return float(width_m) ** exponent


def count_cycles(D: nx.MultiDiGraph) -> int:
    """Directed cycles (parallel edges collapsed, antiparallel ones kept), counted up to a bound."""
    S = nx.DiGraph(D)
    if nx.is_directed_acyclic_graph(S):
        return 0
    return sum(1 for _ in itertools.islice(nx.simple_cycles(S), MAX_CYCLES))


def apply_shares(D: nx.MultiDiGraph) -> float:
    """share = capacity / sum of the out-edge capacities of each node (1 for a single out-edge).
    Returns the largest |sum of shares - 1| over the splitting nodes."""
    err = 0.0
    for n in D.nodes:
        out = list(D.out_edges(n, keys=True, data=True))
        if not out:
            continue
        if len(out) == 1:
            out[0][3]["share"] = 1.0
            continue
        tot = sum(d["capacity"] for *_, d in out)
        for *_, d in out:
            d["share"] = d["capacity"] / tot if tot > 0 else 1.0 / len(out)
        err = max(err, abs(sum(d["share"] for *_, d in out) - 1.0))
    return err


def apply_flux(D: nx.MultiDiGraph) -> bool:
    """Flux per edge: total 1 split over the sources by the capacity of their out-edges, then
    inflow(node) x share down the topological order. When the in -> out links of reservoir hubs close
    a loop (a channel leaves a reservoir and re-enters it), the node inflows solve
    (I - A) x = injection instead. False (flux unset) when no flow can be solved."""
    start = {n: sum(d["capacity"] for *_, d in D.out_edges(n, data=True))
             for n in D.nodes if D.in_degree(n) == 0 and D.out_degree(n) > 0 and not D.nodes[n].get("closed")}
    total = sum(start.values())
    if nx.is_directed_acyclic_graph(nx.DiGraph(D)):
        for n in nx.topological_sort(D):
            inflow = start[n] / total if n in start else sum(d["flux"] for *_, d in D.in_edges(n, data=True))
            for *_, d in D.out_edges(n, data=True):
                d["flux"] = inflow * d["share"]
        return True
    if not total > 0:
        return False
    nodes = list(D.nodes)
    idx = {n: i for i, n in enumerate(nodes)}
    A = np.zeros((len(nodes), len(nodes)))
    for u, v, d in D.edges(data=True):
        A[idx[v], idx[u]] += d["share"]
    inj = np.array([start.get(n, 0.0) / total for n in nodes])
    try:
        x = np.linalg.solve(np.eye(len(nodes)) - A, inj)
    except np.linalg.LinAlgError:
        return False
    if not np.isfinite(x).all() or x.min() < -1e-9 or x.max() > 1e6:
        return False
    for u, v, d in D.edges(data=True):
        d["flux"] = float(x[idx[u]] * d["share"])
    return True


# ---------------------------------------------------------------- reservoir hubs and connectors

def _res_node(rid: str) -> str:
    return f"res:{rid}"


def assign_ports(G, reservoirs, guards: Guards, t: Affine, nc: NetworkConfig) -> None:
    """Free ends touching a reservoir zone get `res` (the id of the nearest polygon)."""
    for n in sorted(G.nodes):
        if G.degree(n) != 1 or not guards.zone(G.nodes[n]["pos"]):
            continue
        pt = Point(rc_to_xy(G.nodes[n]["pos"][None], t)[0])
        best = min(((p.distance(pt), rid) for rid, p in reservoirs), default=None)
        if best is not None:
            G.nodes[n]["res"] = best[1]


def _course_extent(course: LineString, poly: Polygon) -> tuple[float, float]:
    """(s_min, s_max) of the course within the polygon; the centroid chainage when it misses."""
    inter = course.intersection(poly)
    if inter.is_empty:
        s = course.project(poly.centroid)
        return s, s
    parts = getattr(inter, "geoms", [inter])
    ss = [course.project(Point(c)) for g in parts for c in g.coords]
    return min(ss), max(ss)


def flow_components(G, reservoirs, course: LineString) -> list[dict]:
    """Connected components of the branch graph with each reservoir hub joined to its ports, ordered
    by min chainage: {nodes, hubs, s_min, s_max, terminals: [(s_up, s_down, ('node'|'hub', id))]}."""
    H = nx.Graph()
    H.add_nodes_from(("n", n) for n in G.nodes)
    H.add_edges_from((("n", u), ("n", v)) for u, v in G.edges())
    ext = {rid: _course_extent(course, p) for rid, p in reservoirs}
    for rid, _ in reservoirs:
        H.add_node(("h", rid))
    for n, d in G.nodes(data=True):
        if "res" in d:
            H.add_edge(("n", n), ("h", d["res"]))
    comps = []
    for cc in nx.connected_components(H):
        ss, term = [], []
        for kind, x in cc:
            if kind == "n":
                ss.append(G.nodes[x]["s"])
                if G.degree(x) == 1 and "res" not in G.nodes[x]:
                    term.append((G.nodes[x]["s"], G.nodes[x]["s"], (kind, x)))
            else:
                ss.extend(ext[x])
                term.append((ext[x][0], ext[x][1], (kind, x)))
        comps.append({"cc": cc, "s_min": min(ss), "s_max": max(ss), "terminals": sorted(term)})
    comps.sort(key=lambda c: (c["s_min"], c["s_max"], min(c["cc"])))
    return comps


def _node_widths(G, n) -> list[float]:
    return [d["mean_width"] for _, _, d in G.edges(n, data=True) if "mean_width" in d]


def add_connectors(G, reservoirs, course: LineString, t: Affine, nc: NetworkConfig,
                   res_m: float) -> tuple[int, list[dict]]:
    """Bridge dams and weirs along the course. Returns (connectors added, gapsLeft)."""
    polys = dict(reservoirs)
    comps = flow_components(G, reservoirs, course)
    added, gaps = 0, []
    front = None
    for c in comps:
        if front is not None and c["s_min"] > front["s_max"]:
            gap = c["s_min"] - front["s_max"]
            if gap < nc.connector_max_m:
                if _connect(G, polys, course, t, nc, res_m, front, c):
                    added += 1
            else:
                gaps.append({"sFrom": round(front["s_max"], 1), "sTo": round(c["s_min"], 1)})
        if front is None or c["s_max"] > front["s_max"]:
            front = c
    return added, gaps


def _terminal_node(G, polys, course: LineString, t: Affine, term, down: bool):
    """Graph node of a terminal; a reservoir hub gets a new port on its boundary nearest the course
    at the hub's extreme chainage. Returns (node id, adjacent mean widths)."""
    kind, x = term[2]
    if kind == "n":
        return x, _node_widths(G, x)
    s = term[1] if down else term[0]
    cp = course.interpolate(s)
    bp = nearest_points(polys[x].boundary, cp)[0]
    n = max(G.nodes, default=-1) + 1
    G.add_node(n, pos=xy_to_rc(np.array([[bp.x, bp.y]]), t)[0], res=x, s=course.project(bp))
    return n, []


def _connect(G, polys, course, t, nc, res_m, a, b) -> bool:
    ta = max(a["terminals"], key=lambda q: (q[1], q[2][1] if q[2][0] == "n" else 0), default=None)
    tb = min(b["terminals"], key=lambda q: (q[0], q[2][1] if q[2][0] == "n" else 0), default=None)
    if ta is None or tb is None or tb[0] <= ta[1]:
        return False
    na, wa = _terminal_node(G, polys, course, t, ta, True)
    nb, wb = _terminal_node(G, polys, course, t, tb, False)
    _add_connector(G, course, t, nc, na, nb, wa + wb)
    return True


def _add_connector(G, course: LineString, t: Affine, nc: NetworkConfig, na: int, nb: int,
                   widths: list[float]) -> None:
    """Flagged connector na -> nb that follows the course; width = mean of `widths` (minBranchWidthM
    when empty)."""
    xa = rc_to_xy(G.nodes[na]["pos"][None], t)[0]
    xb = rc_to_xy(G.nodes[nb]["pos"][None], t)[0]
    sa, sb = course.project(Point(xa)), course.project(Point(xb))
    mid = substring(course, sa, sb)
    xy = np.vstack([xa, np.array(course.interpolate(sa).coords)[0], np.array(mid.coords),
                    np.array(course.interpolate(sb).coords)[0], xb])
    rc = _dedupe(xy_to_rc(xy, t))
    mw = float(np.mean(widths)) if widths else nc.min_branch_width_m
    G.add_edge(na, nb, path=rc, a=na, b=nb, kind="connector", narrow=False, mean_width=mw)


def connect_course_stubs(G, reservoirs, course: LineString, t: Affine, nc: NetworkConfig, width_m,
                         along: Callable[[np.ndarray], float], is_border: Callable[[np.ndarray], bool]) -> int:
    """Before dead ends are pruned: a course-following stub (a free end inside the grid, not a
    terminal, whose branch has at least minComponentM within coverTolM of the course) is bridged along
    the course across a dry gap of at most connectorMaxM to the nearest thing ahead of it: a reservoir
    (a new port at its extreme chainage), a grid-border or course-end free end, or a stub facing it.
    The target must lie within coverTolM of the course, and the gap must be uncovered: the course
    between the two chainages must not already lie within coverTolM of another channel, so two
    dead-end braids beside a wet main channel are never joined. Returns the number of connectors."""
    polys = dict(reservoirs)
    ext = {rid: _course_extent(course, p) for rid, p in reservoirs}
    stubs: dict[int, int] = {}  # node -> +1 when the free end lies downstream of its branch, else -1
    border = []
    for n in sorted(G.nodes):
        nd = G.nodes[n]
        if G.degree(n) != 1 or "res" in nd:
            continue
        if is_border(nd["pos"]):
            border.append(n)
            continue
        u, v, k = next(iter(G.edges(n, keys=True)))
        d = G.edges[u, v, k]
        if d["kind"] == "connector" or along(d["path"]) < nc.min_component_m:
            continue
        other = v if u == n else u
        ds = nd["s"] - G.nodes[other]["s"]
        if ds != 0:
            stubs[n] = 1 if ds > 0 else -1
    chan = [(u, v, k, rc_to_xy(d["path"], t)) for u, v, k, d in G.edges(keys=True, data=True)
            if d["kind"] == "channel" and len(d["path"]) >= 2]

    def uncovered(s_a: float, s_b: float, skip: set) -> bool:
        """True when some 20 m sample of the course between s_a and s_b is farther than coverTolM from
        every channel except the edges in `skip`."""
        others = [LineString(xy) for u, v, k, xy in chan if (u, v, k) not in skip and (v, u, k) not in skip]
        pts = _resample(substring(course, min(s_a, s_b), max(s_a, s_b)), 20.0)
        if not others:
            return True
        cov = unary_union(others).buffer(nc.cover_tol_m, quad_segs=2)
        return not bool(shapely.contains_xy(cov, pts[:, 0], pts[:, 1]).all())

    added, taken = 0, set()
    for n, sgn in sorted(stubs.items()):
        if n in taken:
            continue
        s_n = G.nodes[n]["s"]
        own = {next(iter(G.edges(n, keys=True)))}
        best = None  # (gap, kind, ref)
        for rid, (lo, hi) in sorted(ext.items()):
            gap = (lo - s_n) if sgn > 0 else (s_n - hi)
            if not (0 < gap <= nc.connector_max_m) or (best is not None and gap >= best[0]):
                continue
            s_t = lo if sgn > 0 else hi
            if polys[rid].boundary.distance(course.interpolate(s_t)) <= nc.cover_tol_m \
                    and uncovered(s_n, s_t, own):
                best = (gap, "h", rid)
        for m in sorted(set(stubs) | set(border)):
            if m == n or m in taken or (m in stubs and stubs[m] != -sgn):
                continue
            gap = (G.nodes[m]["s"] - s_n) * sgn
            if not (0 < gap <= nc.connector_max_m) or (best is not None and gap >= best[0]):
                continue
            xy = rc_to_xy(G.nodes[m]["pos"][None], t)[0]
            if course.distance(Point(xy)) <= nc.cover_tol_m \
                    and uncovered(s_n, G.nodes[m]["s"], own | set(G.edges(m, keys=True))):
                best = (gap, "n", m)
        if best is None:
            continue
        u, v, k = next(iter(G.edges(n, keys=True)))
        wa = [float(path_widths(G.edges[u, v, k]["path"], width_m).mean())]
        if best[1] == "h":
            lo, hi = ext[best[2]]
            nb, wb = _terminal_node(G, polys, course, t, (lo, hi, ("h", best[2])), sgn < 0)
        else:
            nb, wb = best[2], []
            taken.add(nb)
        taken.add(n)
        _add_connector(G, course, t, nc, n, nb, wa + wb)
        added += 1
    return added


# ---------------------------------------------------------------- geometry

def chaikin(xy: np.ndarray, iterations: int) -> np.ndarray:
    """Chaikin corner cutting of an open polyline with fixed end points."""
    for _ in range(iterations):
        if len(xy) < 3:
            break
        out = [xy[0]]
        last = len(xy) - 2
        for i in range(len(xy) - 1):
            p, q = xy[i], xy[i + 1]
            if i > 0:
                out.append(0.75 * p + 0.25 * q)
            if i < last:
                out.append(0.25 * p + 0.75 * q)
        out.append(xy[-1])
        xy = np.array(out)
    return xy


def branch_geometry(rc: np.ndarray, t: Affine, nc: NetworkConfig, smooth: bool) -> np.ndarray:
    xy = rc_to_xy(rc, t)
    if smooth:
        xy = chaikin(xy, nc.chaikin_iterations)
    if len(xy) > 2 and nc.simplify_m > 0:
        xy = np.array(LineString(xy).simplify(nc.simplify_m).coords)
    return xy


# ---------------------------------------------------------------- QA

def _resample(line, step: float) -> np.ndarray:
    n = max(int(line.length // step), 0)
    d = np.append(np.arange(n + 1) * step, line.length) if line.length > 0 else np.zeros(1)
    d = np.unique(np.minimum(d, line.length))
    pts = shapely.line_interpolate_point(line, d)
    return np.column_stack([shapely.get_x(pts), shapely.get_y(pts)])


def inside_fraction(xy: np.ndarray, mask: np.ndarray, t: Affine) -> float | None:
    if len(xy) == 0:
        return None
    r, c = _pix(xy_to_rc(xy, t), mask.shape)
    return float(mask[r, c].mean())


# ---------------------------------------------------------------- entry

def _near_border(pos, shape) -> bool:
    r, c = int(round(pos[0])), int(round(pos[1]))
    return min(r, c, shape[0] - 1 - r, shape[1] - 1 - c) < BORDER_PX


def _is_terminal(pos, shape, t: Affine, course_xy: np.ndarray, nc: NetworkConfig) -> bool:
    """A free end where the river enters or leaves: at the grid border or near a course end."""
    if _near_border(pos, shape):
        return True
    ends = np.array([course_xy[0], course_xy[-1]])
    xy = rc_to_xy(np.asarray(pos)[None], t)[0]
    return bool(np.hypot(*(ends - xy).T).min() <= 2 * nc.cover_tol_m)


def _term_hubs(stack: Stack, reservoirs, nc: NetworkConfig) -> dict[str, str]:
    """Hubs holding the course's first vertex (entry) and last vertex (exit), within coverTolM."""
    out = {}
    for label, xy in (("entry", stack.course_xy[0]), ("exit", stack.course_xy[-1])):
        best = min(((p.distance(Point(xy)), rid) for rid, p in reservoirs), default=None)
        if best is not None and best[0] <= nc.cover_tol_m:
            out[best[1]] = label
    return out


def _guards(stack: Stack, wr: WaterResult, nc: NetworkConfig, res_m: float) -> Guards:
    shape = wr.water.shape
    if wr.zone.any():
        zd = ndimage.distance_transform_edt(~wr.zone) * res_m
    else:
        zd = np.full(shape, np.inf)
    t = stack.grid.transform
    ends = np.array([stack.course_xy[0], stack.course_xy[-1]])

    def zone(pos) -> bool:
        r, c = _pix(np.asarray(pos)[None], shape)
        return bool(zd[r[0], c[0]] <= nc.port_touch_m)

    def free(pos) -> bool:
        r, c = int(round(pos[0])), int(round(pos[1]))
        if min(r, c, shape[0] - 1 - r, shape[1] - 1 - c) >= BORDER_PX:
            return False
        xy = rc_to_xy(np.asarray(pos)[None], t)[0]
        return bool(np.hypot(*(ends - xy).T).min() <= 2 * nc.cover_tol_m)

    return Guards(zone, free)


def _direct(G, course: LineString, dem: np.ndarray, t: Affine, nc: NetworkConfig):
    """Orient the undirected graph into a MultiDiGraph of branch edges; returns (D, counts)."""
    D = nx.MultiDiGraph()
    D.add_nodes_from(G.nodes(data=True))
    counts = {"course": 0, "dem": 0, "tangent": 0}
    for u, v, k, d in G.edges(keys=True, data=True):
        path = d["path"]
        a_n, b_n = d["a"], d["b"]
        xa, xb = rc_to_xy(G.nodes[a_n]["pos"][None], t)[0], rc_to_xy(G.nodes[b_n]["pos"][None], t)[0]
        mid = rc_to_xy(path[len(path) // 2][None], t)[0]
        if d["kind"] == "connector":
            flip, how = G.nodes[a_n]["s"] > G.nodes[b_n]["s"], "course"
        else:
            flip, how = orient_edge(course, xa, xb, mid, _dem_at(dem, G.nodes[a_n]["pos"]),
                                    _dem_at(dem, G.nodes[b_n]["pos"]), nc)
        counts[how] += 1
        f, to = (b_n, a_n) if flip else (a_n, b_n)
        D.add_edge(f, to, path=_oriented(d, f), kind=d["kind"], narrow=d["narrow"], orient=how,
                   mean_width=d["mean_width"], const_width=d["kind"] == "connector")
    return D, counts


def _hub_in(rid: str) -> str:
    return f"{_res_node(rid)}:in"


def _hub_out(rid: str) -> str:
    return f"{_res_node(rid)}:out"


def _add_hubs(D, G, reservoirs) -> None:
    """Two hubs per reservoir, res:<id>:in and res:<id>:out (internal, never written as nodes). A port
    whose branch flows into it gets port -> in; any other port gets out -> port. A channel that leaves
    and re-enters one reservoir therefore runs out -> ... -> in, which is not a cycle."""
    for rid, _ in reservoirs:
        D.add_node(_hub_in(rid))
        D.add_node(_hub_out(rid))
    for n, d in G.nodes(data=True):
        if "res" not in d:
            continue
        if D.in_degree(n) > 0:
            h = _hub_in(d["res"])
            D.add_edge(n, h, kind="reservoir", mean_width=None)
            D.edges[n, h, 0]["capacity"] = sum(x["capacity"] for *_, x in D.in_edges(n, data=True))
        else:
            h = _hub_out(d["res"])
            D.add_edge(h, n, kind="reservoir", mean_width=None)
            D.edges[h, n, 0]["capacity"] = sum(x["capacity"] for *_, x in D.out_edges(n, data=True)
                                               if x["kind"] != "reservoir")


def _link_hubs(D, reservoirs) -> None:
    """The water of a reservoir passes from its in hub to its out hub (total inflow = total outflow)
    when it has both. Added after the cycle count: the hubs are separate for it. A reservoir whose out
    side reaches no drain (a node without out-edges: a sink, a grid-border or course-end terminal, a
    reservoir with no outlet) except by coming back into it is itself the drain, as when it has no
    outlet: it gets no link, its in hub is a sink, and its out hub is flagged `closed` (never a source;
    what leaves it carries flux 0)."""
    cand = [rid for rid, _ in reservoirs if D.in_degree(_hub_in(rid)) > 0 and D.out_degree(_hub_out(rid)) > 0]
    H = nx.DiGraph(D)
    for rid in cand:
        H.add_edge(_hub_in(rid), _hub_out(rid))
    for rid in cand:
        i, o = _hub_in(rid), _hub_out(rid)
        if any(H.out_degree(n) == 0 for n in nx.descendants(H, o)):
            D.add_edge(i, o, kind="reservoir", mean_width=None, link=True,
                       capacity=sum(d["capacity"] for *_, d in D.in_edges(i, data=True)))
        else:
            D.nodes[o]["closed"] = True


def _node_kind(D, n, is_port: bool) -> str:
    i, o = D.in_degree(n), D.out_degree(n)
    if is_port:
        return "port"
    if i == 0:
        return "source"
    if o == 0:
        return "sink"
    if o > 1:
        return "split"
    return "join" if i > 1 else "pass"


def build_network(cfg: Config, stack: Stack, wr: WaterResult) -> Network:
    nc, res = cfg.network, cfg.resolution_m
    t = stack.grid.transform
    shape = wr.water.shape
    course = LineString(stack.course_xy)
    width_m = width_grid(wr.edt_m, res)
    guards = _guards(stack, wr, nc, res)

    G = build_multigraph(skeletonise(wr.channel, wr.water))
    st = clean_graph(G, res, width_m, guards, nc)
    for n, d in G.nodes(data=True):
        d["s"] = course.project(Point(rc_to_xy(d["pos"][None], t)[0]))
    assign_ports(G, wr.reservoirs, guards, t, nc)
    hubs = _term_hubs(stack, wr.reservoirs, nc)
    is_border = lambda p: _is_terminal(p, shape, t, stack.course_xy, nc)
    along = along_course(course, t, nc.cover_tol_m)
    connect_course_stubs(G, wr.reservoirs, course, t, nc, width_m, along, is_border)
    core = prune_core(G, res, is_border,
                      {rid for rid, _ in wr.reservoirs},  # every reservoir is a terminal
                      along, nc.min_component_m)
    core["selfLoops"] = G.graph.get("selfLoops", 0)
    for _, _, d in G.edges(data=True):
        if d["kind"] != "connector":
            d["mean_width"] = float(path_widths(d["path"], width_m).mean())
    ends = [G.nodes[n]["s"] for n in G.nodes if G.degree(n) == 1 and "res" not in G.nodes[n]
            and _is_terminal(G.nodes[n]["pos"], shape, t, stack.course_xy, nc)]
    half = course.length / 2.0
    st["entries"] = sum(s <= half for s in ends) + list(hubs.values()).count("entry")
    st["exits"] = sum(s > half for s in ends) + list(hubs.values()).count("exit")
    st.update(core)
    # loops of the core channel graph, before connectors
    chan = nx.MultiGraph()
    chan.add_nodes_from(G.nodes)
    chan.add_edges_from((u, v, d) for u, v, d in G.edges(data=True) if d["kind"] == "channel")
    parallel = chan.number_of_edges() - chan.number_of_nodes() + nx.number_connected_components(chan)
    channel_km = sum(path_len_m(d["path"], res) for _, _, d in chan.edges(data=True)) / 1000.0

    connectors, gaps = add_connectors(G, wr.reservoirs, course, t, nc, res)
    for n, d in G.nodes(data=True):
        if "s" not in d:
            d["s"] = course.project(Point(rc_to_xy(d["pos"][None], t)[0]))

    D, orient = _direct(G, course, stack.dem, t, nc)
    for *_, d in D.edges(data=True):
        d["capacity"] = capacity(d["mean_width"], nc.capacity_exponent)
    _add_hubs(D, G, wr.reservoirs)
    cycles = count_cycles(D)
    _link_hubs(D, wr.reservoirs)
    share_err = apply_shares(D)
    flux_ok = cycles == 0 and apply_flux(D)
    if cycles == 0 and not flux_ok:
        cycles = 1  # flux could not be solved: counted as a cycle, so flux is null exactly when cycles > 0
    connectors = sum(d["kind"] == "connector" for *_, d in G.edges(data=True))

    net = _assemble(D, G, wr, t, nc, res, flux_ok, cycles)
    net.stats = _qa(net, G, D, wr, stack, course, t, nc, res, st, parallel, channel_km, connectors,
                    gaps, orient, cycles, share_err)
    return net


def _assemble(D, G, wr, t, nc, res, flux_ok: bool, cycles: int) -> Network:
    used = sorted({n for u, v, d in D.edges(data=True) if d["kind"] != "reservoir" for n in (u, v)},
                  key=lambda n: (G.nodes[n]["s"], *rc_to_xy(G.nodes[n]["pos"][None], t)[0]))
    nid = {n: f"n{i}" for i, n in enumerate(used)}
    ports = {n for n in used if "res" in G.nodes[n]}
    nodes = []
    for n in used:
        x, y = rc_to_xy(G.nodes[n]["pos"][None], t)[0]
        nodes.append(NetNode(nid[n], _node_kind(D, n, n in ports), float(x), float(y),
                             float(G.nodes[n]["s"])))
    rows = []
    for u, v, k, d in D.edges(keys=True, data=True):
        if d["kind"] == "reservoir":
            continue
        rc = d["path"].copy()
        rc[0], rc[-1] = G.nodes[u]["pos"], G.nodes[v]["pos"]
        xy = branch_geometry(rc, t, nc, d["kind"] == "channel")
        if d["const_width"]:
            hw = np.full(len(xy), d["mean_width"] / 2.0)
        else:
            r, c = _pix(xy_to_rc(xy, t), wr.edt_m.shape)
            hw = half_width_grid(wr.edt_m, res)[r, c].astype(float)
        length = float(np.hypot(*np.diff(xy, axis=0).T).sum())
        mid = LineString(xy).interpolate(0.5, normalized=True)
        rows.append(((G.nodes[u]["s"], G.nodes[v]["s"], float(xy[0, 0]), float(xy[0, 1]), mid.x, mid.y),
                     u, v, xy,
                     hw, length, d))
    rows.sort(key=lambda r: r[0])
    branches = []
    for i, (_, u, v, xy, hw, length, d) in enumerate(rows):
        branches.append(NetBranch(
            f"b{i}", d["kind"], nid[u], nid[v], xy, hw, round(d["mean_width"], 2), round(length, 1),
            d["share"], d.get("flux") if flux_ok else None,
            d["orient"], bool(d["narrow"])))
    nports = []
    for n in used:
        if n not in ports:
            continue
        rid = G.nodes[n]["res"]
        x, y = rc_to_xy(G.nodes[n]["pos"][None], t)[0]
        if D.has_edge(n, _hub_in(rid)):
            e, role = D.edges[n, _hub_in(rid), 0], "inlet"
        else:
            e, role = D.edges[_hub_out(rid), n, 0], "outlet"
        nports.append(NetPort(G.nodes[n]["res"], nid[n], role, float(x), float(y),
                              e.get("share"), e.get("flux") if flux_ok else None))
    nports.sort(key=lambda p: (p.reservoir, p.node))
    return Network(nodes, branches, nports, list(wr.reservoirs))


def _qa(net: Network, G, D, wr, stack, course, t, nc, res, st, parallel, channel_km, connectors,
        gaps, orient, cycles, share_err) -> dict:
    kinds = [n.kind for n in net.nodes]
    ends = [n for n in D.nodes if D.degree(n) > 0]
    chan = [b for b in net.branches if b.kind == "channel"]
    lines = [LineString(b.xy) for b in net.branches]
    polys = [p for _, p in net.reservoirs]
    cov_geom = unary_union([MultiLineString(lines).buffer(nc.cover_tol_m, quad_segs=2)] + polys) \
        if lines or polys else None
    pts = _resample(course, 20.0)
    if cov_geom is None:
        cover = 0.0
    else:
        shapely.prepare(cov_geom)
        cover = float(shapely.contains_xy(cov_geom, pts[:, 0], pts[:, 1]).mean())
    wet = ndimage.binary_dilation(wr.water, structure=EIGHT)
    cp = [_resample(LineString(b.xy), 10.0) for b in chan]
    inside = inside_fraction(np.vstack(cp), wet, t) if cp else None
    f1 = inside_fraction(_resample(course, 10.0), wet, t)
    in_wet = shapely.contains_xy(cov_geom, pts[:, 0], pts[:, 1]) if cov_geom is not None \
        else np.zeros(len(pts), bool)
    wet_pts = wet[_pix(xy_to_rc(pts, t), wet.shape)]
    wet_cover = float(in_wet[wet_pts].mean()) if wet_pts.any() else None
    r4 = lambda x: None if x is None else round(x, 4)
    return {
        "branches": len(net.branches),
        "channelKm": round(channel_km, 3),
        "connectors": connectors,
        "gapsLeft": gaps,
        "splits": kinds.count("split"),
        "joins": kinds.count("join"),
        "sources": sum(D.in_degree(n) == 0 and not D.nodes[n].get("closed") for n in ends),  # hubs included
        "sinks": sum(D.out_degree(n) == 0 for n in ends),
        "ports": len(net.ports),
        "parallelArms": parallel,
        "orient": orient,
        "cycles": cycles,
        "shareErrorMax": float(f"{share_err:.3g}"),
        "prunedSpurs": st["prunedSpurs"],
        "droppedNarrow": st["droppedNarrow"],
        "keptNarrow": st["keptNarrow"],
        "droppedComponents": st["droppedComponents"],
        "deadEndsDropped": {"count": st["deadEnds"], "km": round(st["deadEndsKm"], 3)},
        "sliversDropped": {"count": st["slivers"], "km": round(st["sliversKm"], 3)},
        "entries": st["entries"],
        "exits": st["exits"],
        "selfLoopsDropped": st["selfLoops"],
        "courseCoverage": r4(cover),
        "wetCourseCoverage": r4(wet_cover),
        "courseInWater": r4(inside_fraction(pts, wet, t)),
        "insideWater": r4(inside),
        "f1InsideWater": r4(f1),
    }
