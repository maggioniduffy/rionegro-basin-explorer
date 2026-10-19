"""Tests of the F2.3 network on small synthetic inputs (no network access)."""

import networkx as nx
import numpy as np
from scipy import ndimage
from shapely.geometry import LineString
from skimage.morphology import skeletonize

import math
from types import SimpleNamespace

import pyproj
from affine import Affine
from shapely.geometry import box

from flowwater.config import NetworkConfig
from flowwater.contract import reservoir_drift
from flowwater.network import (
    Guards, _add_hubs, _direct, _link_hubs, along_course, apply_flux, apply_shares, build_multigraph, capacity,
    clean_graph, connect_course_stubs, count_cycles, orient_edge, prune_core, width_grid,
)

NC = NetworkConfig(
    spur_min_px=15, spur_width_factor=1.5, min_branch_width_m=30, min_component_m=200,
    port_touch_m=20, connector_max_m=600, orient_min_m=40, dem_min_drop_m=1,
    capacity_exponent=1.5, chaikin_iterations=2, simplify_m=3, cover_tol_m=75,
)


def test_island_gives_two_parallel_edges():
    water = np.zeros((60, 240), bool)
    water[10:50, :] = True
    water[25:35, 90:150] = False  # 10 x 60 px island
    res = 10.0
    width_m = width_grid(ndimage.distance_transform_edt(water) * res, res)
    sk = skeletonize(np.pad(water, 40, mode="edge"))[40:-40, 40:-40]
    G = build_multigraph(sk)
    clean_graph(G, res, width_m, Guards(), NC)
    junctions = [n for n in G.nodes if G.degree(n) == 3]
    assert len(junctions) == 2
    u, v = junctions
    assert G.number_of_edges(u, v) == 2  # a MultiGraph keeps both arms


def test_orientation_by_chainage_then_dem():
    course = LineString([(0, 0), (1000, 0)])
    flip, how = orient_edge(course, (500, 0), (100, 0), (300, 0), float("nan"), float("nan"), NC)
    assert (flip, how) == (True, "course")
    flip, how = orient_edge(course, (500, 0), (520, 0), (510, 0), 105.0, 100.0, NC)
    assert (flip, how) == (False, "dem")
    flip, how = orient_edge(course, (500, 0), (520, 0), (510, 0), 100.0, 105.0, NC)
    assert (flip, how) == (True, "dem")


def test_split_join_shares_and_flux():
    D = nx.MultiDiGraph()
    for u, v, w in [("s", "a", 90), ("a", "b", 60), ("a", "b", 30), ("b", "t", 90)]:
        D.add_edge(u, v, capacity=capacity(w, 1.5))
    assert count_cycles(D) == 0
    err = apply_shares(D)
    assert apply_flux(D)
    big, small = capacity(60, 1.5), capacity(30, 1.5)
    shares = sorted(d["share"] for _, _, d in D.out_edges("a", data=True))
    assert np.allclose(shares, sorted([small / (big + small), big / (big + small)]))
    assert err < 1e-12 and abs(sum(shares) - 1) < 1e-12
    assert abs(D.edges["b", "t", 0]["flux"] - 1) < 1e-12


def _edge(G, a, b, rc):
    G.add_edge(a, b, path=np.array(rc, float), a=a, b=b, kind="channel", narrow=False)


def test_core_pruning_drops_dead_ends_and_slivers():
    G = nx.MultiGraph()
    pos = {0: (5, 0), 1: (5, 50), 2: (5, 100), 3: (55, 50), 4: (30, 20), 5: (30, 40)}
    for n, p in pos.items():
        G.add_node(n, pos=np.array(p, float), s=p[1] * 10.0)
    _edge(G, 0, 1, [(5, c) for c in range(0, 51)])
    _edge(G, 1, 2, [(5, c) for c in range(50, 101)])
    _edge(G, 1, 3, [(r, 50) for r in range(5, 56)])  # dead-end arm, 50 px
    G.nodes[4]["res"] = G.nodes[5]["res"] = "r0"
    _edge(G, 4, 5, [(30, c) for c in range(20, 41)])  # sliver between two ports of r0
    # multi-branch bypass between two ports of r0 (an island in the middle)
    for n, p in {6: (60, 10), 7: (60, 20), 8: (60, 40), 9: (60, 50)}.items():
        G.add_node(n, pos=np.array(p, float), s=p[1] * 10.0)
    G.nodes[6]["res"] = G.nodes[9]["res"] = "r0"
    _edge(G, 6, 7, [(60, c) for c in range(10, 21)])
    _edge(G, 7, 8, [(55, c) for c in range(20, 41)])
    _edge(G, 7, 8, [(65, c) for c in range(20, 41)])
    _edge(G, 8, 9, [(60, c) for c in range(40, 51)])
    T = Affine(10, 0, 0, 0, -10, 0)
    far = along_course(LineString([(0, -55), (1100, -55)]), T, 75.0)  # the bypass is 500 m away
    st = prune_core(G, 10.0, lambda p: p[1] < 3 or p[1] > 97, along=far, keep_m=200.0)
    assert (st["deadEnds"], st["slivers"]) == (1, 5)
    assert sorted(G.nodes) == [0, 2] and G.number_of_edges() == 1
    for *_, d in G.edges(data=True):
        d["mean_width"] = 60.0
    course = LineString([(0, -55), (1100, -55)])
    D, _ = _direct(G, course, np.full((100, 120), np.nan), Affine(10, 0, 0, 0, -10, 0), NC)
    assert sum(D.in_degree(n) == 0 for n in D) == 1 and sum(D.out_degree(n) == 0 for n in D) == 1


def test_width_of_strips_is_not_biased():
    res = 10.0
    for rows, want in ((3, 30.0), (1, 10.0)):
        water = np.zeros((9, 120), bool)
        water[4 : 4 + rows, :] = True
        w = width_grid(ndimage.distance_transform_edt(np.pad(water, 3))[3:-3, 3:-3] * res, res)
        sk = skeletonize(water)
        assert np.median(w[sk]) == want


def test_bypass_along_the_course_survives():
    G = nx.MultiGraph()
    for n, p in {6: (5, 10), 7: (5, 20), 8: (5, 60), 9: (5, 70)}.items():
        G.add_node(n, pos=np.array(p, float), s=p[1] * 10.0, **({"res": "r0"} if n in (6, 9) else {}))
    _edge(G, 6, 7, [(5, c) for c in range(10, 21)])
    _edge(G, 7, 8, [(4, c) for c in range(20, 61)])
    _edge(G, 7, 8, [(6, c) for c in range(20, 61)])
    _edge(G, 8, 9, [(5, c) for c in range(60, 71)])
    near = along_course(LineString([(0, -55), (1100, -55)]), Affine(10, 0, 0, 0, -10, 0), 75.0)
    st = prune_core(G, 10.0, lambda p: False, {"r0"}, along=near, keep_m=200.0)
    assert st["slivers"] == 0 and G.number_of_edges() == 4


def test_course_stub_across_a_dry_gap_is_kept_by_a_connector():
    T = Affine(10, 0, 0, 0, -10, 0)
    course = LineString([(0, -55), (2400, -55)])
    r0 = box(1300, -100, 2200, -10)  # reservoir whose course extent starts 295 m past the stub end
    G = nx.MultiGraph()
    for n, p in {0: (5, 0), 1: (5, 40), 2: (5, 100), 3: (8, 150)}.items():
        G.add_node(n, pos=np.array(p, float), s=p[1] * 10.0 + 5.0, **({"res": "r0"} if n == 3 else {}))
    _edge(G, 0, 1, [(5, c) for c in range(0, 41)])
    _edge(G, 1, 2, [(5, c) for c in range(40, 101)])  # stub along the course, free end at col 100
    _edge(G, 1, 3, [(r, 40) for r in range(5, 19)] + [(18, c) for c in range(41, 151)]
          + [(r, 150) for r in range(17, 7, -1)])  # detour 130 m off the course
    along = along_course(course, T, 75.0)
    is_border = lambda p: p[1] < 3
    width = np.full((20, 300), 40.0)
    n = connect_course_stubs(G, [("r0", r0)], course, T, NC, width, along, is_border)
    assert n == 1
    st = prune_core(G, 10.0, is_border, {"r0"}, along, NC.min_component_m)
    assert st["deadEnds"] == 0 and 2 in G and G.degree(2) == 2
    conn = [(u, v) for u, v, d in G.edges(data=True) if d["kind"] == "connector"]
    assert len(conn) == 1 and 2 in conn[0] and G.nodes[(set(conn[0]) - {2}).pop()]["res"] == "r0"


def test_channel_leaving_and_reentering_a_reservoir_is_no_cycle():
    G = nx.MultiGraph()
    for n in ("P1", "P2", "P3", "P4"):
        G.add_node(n, res="r0")
    D = nx.MultiDiGraph()
    for u, v in [("A", "P1"), ("P2", "P3"), ("P4", "Z")]:  # P2 -> P3: a side channel across a bay
        D.add_edge(u, v, kind="channel", capacity=1.0)
    _add_hubs(D, G, [("r0", None)])
    assert count_cycles(D) == 0
    _link_hubs(D, [("r0", None)])
    apply_shares(D)
    assert apply_flux(D)
    flux = lambda u, v: D.edges[u, v, 0]["flux"]
    # inflow = 1 from A + the recirculated half of the outflow T, so T = 2
    assert abs(flux("A", "P1") - 1) < 1e-9 and abs(flux("P2", "P3") - 1) < 1e-9
    assert abs(flux("P4", "Z") - 1) < 1e-9 and abs(flux("res:r0:in", "res:r0:out") - 2) < 1e-9


def test_drift_is_rotated_by_the_meridian_convergence():
    def drift(lon):
        x, y = pyproj.Transformer.from_crs("EPSG:4326", "EPSG:32719", always_xy=True).transform(lon, -39.0)
        poly = box(x - 500, y - 500, x + 500, y + 500)
        course = LineString([(x, y - 2000), (x, y + 2000)])
        pin, pout = SimpleNamespace(x=x, y=y - 400), SimpleNamespace(x=x, y=y + 400)  # grid north
        return reservoir_drift(poly, [pin], [pout], course, "EPSG:32719")[0]

    e, n = drift(-69.0)  # central meridian: grid north is true north
    assert abs(e) < 1e-3 and abs(n - 1) < 1e-3
    e, n = drift(-63.0)  # gamma = 6 deg x sin(-39 deg) = -3.8 deg: grid north lies west of true north
    assert e < 0 and abs(e + math.sin(math.radians(6 * math.sin(math.radians(39))))) < 5e-3
    assert abs(math.hypot(e, n) - 1) < 1e-3


def test_reservoir_whose_only_outlet_reenters_it_is_the_drain():
    G = nx.MultiGraph()
    for n in ("P1", "P2", "P3"):
        G.add_node(n, res="r0")
    D = nx.MultiDiGraph()
    for u, v in [("A", "P1"), ("P2", "P3")]:  # P2 -> P3 re-enters r0; nothing else drains
        D.add_edge(u, v, kind="channel", capacity=1.0)
    _add_hubs(D, G, [("r0", None)])
    assert count_cycles(D) == 0
    _link_hubs(D, [("r0", None)])
    assert not D.has_edge("res:r0:in", "res:r0:out") and D.nodes["res:r0:out"]["closed"]
    apply_shares(D)
    assert apply_flux(D)
    assert abs(D.edges["A", "P1", 0]["flux"] - 1) < 1e-9
    assert D.edges["P2", "P3", 0]["flux"] == 0 and D.edges["res:r0:out", "P2", 0]["flux"] == 0
    assert [n for n in D if D.in_degree(n) == 0 and D.out_degree(n) > 0 and not D.nodes[n].get("closed")] == ["A"]
    assert D.out_degree("res:r0:in") == 0  # the reservoir is the sink
