"""
Water probe of the flow-water step (I1.P): runs the water and network stages of the detector on a small
box (or a whole section), renders every stage as a PNG and writes one self-contained HTML plus a report.

    flowwater-probe --region <id> (--case <name> | --bbox lon1,lat1,lon2,lat2 | --at "<url or z/lat/lon>"
                    [--size-km 3] | --section <id>) [--section <id>] [--set key=value ...]
                    [--sweep key=a,b,c] [--truth file.geojson] [--reselect]

--region is required (no default region). Target: --case reads regions/<id>/flow-water.cases.json
({"cases": [{name, bbox?, section?, truth?, note?}]}, truth relative to regions/<id>/flow-water-cases/);
--at takes a MapLibre URL fragment (#zoom/lat/lon) or z/lat/lon and builds a square of --size-km;
--section alone is exactly the pipeline grid. Without a bbox the grid is the section's; with one the
grid is the box snapped like the pipeline and --section only gives the course (clipped to the box).

Data: the pipeline cache of a section (data/work/<id>/flow-water/cache/<section>/, read only) when it is
complete and holds the grid, else data/work/<id>/flow-water-probe/cache/<grid hash>/ (scenes and DEM
read from the network once). Stages, in the order of build_water: per look false colour, MNDWI, NDVI;
invalid-look count; frequency; threshold mask; closed; holes filled; corridor-kept (needs a course;
else all components); reservoir zones; channel; skeleton; with a course the network (pruned skeleton
pixels in another colour). --set overrides config values (dotted keys); --sweep key=a,b,c runs the
stages once per value. --truth (GeoJSON, labels water/land/arm) adds IoU, FP/FN km2 and missed arms.
Writes data/work/<id>/flow-water-probe/<name>/index.html and report.json (deterministic, timings
only under lastRun).
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import html
import io
import json
import logging
import re
import sys
import time
from pathlib import Path

import numpy as np
import pyproj
import rasterio
from PIL import Image, ImageDraw
from rasterio.features import rasterize
from scipy import ndimage
from shapely.geometry import LineString, MultiLineString, Point, box, mapping, shape
from shapely.ops import transform as shp_transform

from flowwater.acquire import (ASSETS, BANDS, Grid, Look, Stack, acquire_on_grid, build_grid,
                               grid_from_bbox, grid_lonlat_bbox, load_course, reflectance)
from flowwater.cli import load_index
from flowwater.config import Config, load_config, parse_overrides
from flowwater.contract import _write
from flowwater.network import build_network, skeletonise, xy_to_rc
from flowwater.paths import ROOT, flow_dir, work_dir
from flowwater.water import (WaterResult, close_padded, edt_metres, fill_small_holes,
                             keep_corridor_components, look_indices, reservoir_zone,
                             vectorise_zones, water_frequency)

log = logging.getLogger("flowwater")

# Reflectance shown as 0..STRETCH in the false-colour composite.
STRETCH = 0.4
LEVELS = 32  # colours of a quantised continuous layer
TRUTH_LABELS = {"water": ("Polygon", "MultiPolygon"), "land": ("Polygon", "MultiPolygon"),
                "arm": ("LineString", "MultiLineString")}
SWEEP_ROOTS = ("water.", "reservoir.", "network.")  # keys that leave the acquired data unchanged


def _die(msg: str) -> "None":
    print(msg, file=sys.stderr)
    raise SystemExit(2)


def probe_dir(region: str) -> Path:
    return work_dir(region).parent / "flow-water-probe"


def cases_path(region: str) -> Path:
    return ROOT / "regions" / region / "flow-water.cases.json"


def cases_dir(region: str) -> Path:
    return ROOT / "regions" / region / "flow-water-cases"


# ---------------------------------------------------------------- target

def parse_bbox(text: str) -> list[float]:
    try:
        v = [float(x) for x in text.split(",")]
    except ValueError:
        v = []
    if len(v) != 4 or not (v[0] < v[2] and v[1] < v[3]):
        _die(f"bbox {text!r}: expected lon1,lat1,lon2,lat2 with lon1 < lon2 and lat1 < lat2")
    return v


def parse_at(text: str) -> tuple[float, float]:
    """(lat, lon) from a URL whose fragment is zoom/lat/lon[/bearing/pitch] or a bare z/lat/lon."""
    frag = text.split("#", 1)[1] if "#" in text else text
    m = re.match(r"^\s*(\d+(?:\.\d+)?)/(-?\d+(?:\.\d+)?)/(-?\d+(?:\.\d+)?)(?:/|\s*$)", frag)
    if not m:
        _die(f"--at {text!r}: expected a URL ending in #zoom/lat/lon or a bare z/lat/lon")
    return float(m.group(2)), float(m.group(3))


def bbox_at(cfg: Config, lat: float, lon: float, size_km: float) -> list[float]:
    """Square of size_km centred on (lat, lon), built in cfg.crs and returned as lon/lat bounds."""
    to_m = pyproj.Transformer.from_crs("EPSG:4326", cfg.crs, always_xy=True)
    to_deg = pyproj.Transformer.from_crs(cfg.crs, "EPSG:4326", always_xy=True)
    x, y = to_m.transform(lon, lat)
    h = size_km * 500.0
    xs, ys = to_deg.transform([x - h, x + h, x - h, x + h], [y - h, y - h, y + h, y + h])
    return [round(min(xs), 6), round(min(ys), 6), round(max(xs), 6), round(max(ys), 6)]


def bbox_name(bbox: list[float]) -> str:
    key = ",".join(f"{v:.6f}" for v in bbox)
    return "bbox-" + hashlib.sha256(key.encode()).hexdigest()[:8]


def load_case(region: str, name: str) -> dict:
    path = cases_path(region)
    if not path.is_file():
        _die(f"{path} not found")
    for c in json.loads(path.read_text())["cases"]:
        if c["name"] == name:
            return c
    _die(f"case {name!r} not in {path}")


def parse_sweep(text: str) -> tuple[str, list]:
    key, eq, vals = text.partition("=")
    if not eq or not key or not vals:
        _die(f"--sweep {text!r}: expected key=a,b,c")
    if not key.startswith(SWEEP_ROOTS):
        _die(f"--sweep {key!r}: only water.*, reservoir.* and network.* keys can be swept")
    out = []
    for v in vals.split(","):
        try:
            out.append(json.loads(v))
        except ValueError:
            out.append(v)
    return key, out


# ---------------------------------------------------------------- data

def _section_cache(region: str, sid: str) -> Path:
    return work_dir(region) / "cache" / sid


def _complete_lock(cfg: Config, cache: Path) -> dict | None:
    """The scene lock of a pipeline cache when it, every look and the DEM are there and the lock
    matches the stac settings; else None."""
    from flowwater.acquire import check_lock

    lock_path = cache / "scenes.lock.json"
    if not (lock_path.is_file() and (cache / "dem.npz").is_file()):
        return None
    lock = json.loads(lock_path.read_text())
    if not all((cache / f"look-{lk['date']}.npz").is_file() for lk in lock["looks"]):
        return None
    try:
        check_lock(cfg, lock)
    except ValueError:
        return None
    return lock


def _window(sec: Grid, grid: Grid) -> tuple[int, int, int, int] | None:
    """(row0, row1, col0, col1) of `grid` inside `sec`, or None when it does not lie on it."""
    if sec.crs != grid.crs or sec.transform.a != grid.transform.a or sec.transform.e != grid.transform.e:
        return None
    c0 = (grid.transform.c - sec.transform.c) / sec.transform.a
    r0 = (grid.transform.f - sec.transform.f) / sec.transform.e
    if abs(c0 - round(c0)) > 1e-6 or abs(r0 - round(r0)) > 1e-6:
        return None
    r0, c0 = round(r0), round(c0)
    if r0 < 0 or c0 < 0 or r0 + grid.height > sec.height or c0 + grid.width > sec.width:
        return None
    return r0, r0 + grid.height, c0, c0 + grid.width


def crop_pipeline_cache(cfg: Config, region: str, sid: str, lock: dict, win, grid: Grid,
                        course_xy: np.ndarray, aoi) -> Stack:
    """Stack of `grid` cut read-only from a section's pipeline cache (same conversion as acquire)."""
    cache = _section_cache(region, sid)
    r0, r1, c0, c1 = win
    aoi_mask = rasterize([(mapping(aoi), 1)], out_shape=(grid.height, grid.width),
                         transform=grid.transform, fill=0, dtype="uint8").astype(bool)
    looks, fractions = [], []
    for lk in lock["looks"]:
        with np.load(cache / f"look-{lk['date']}.npz") as z:
            dn = {n: z[n][r0:r1, c0:c1] for n in ASSETS}
        bands = {}
        for n in BANDS:
            p = {(i["assets"][n]["scale"], i["assets"][n]["offset"], i["assets"][n]["nodata"])
                 for i in lk["items"]}
            if len(p) != 1:
                raise RuntimeError(f"look {lk['date']} {n}: items disagree on scale/offset {p}")
            sc, off, nd = p.pop()
            bands[n] = reflectance(dn[n], sc, off, nd)
        clear = np.isin(dn["scl"], cfg.water.scl_valid) & (dn["green"] != 0)
        fractions.append(round(float(clear[aoi_mask].mean()), 4))
        looks.append(Look(lk["date"], [i["id"] for i in lk["items"]], bands, dn["scl"]))
    with np.load(cache / "dem.npz") as z:
        dem = z["dem"][r0:r1, c0:c1]
    warnings: list[str] = []
    cov = round(float((~np.isnan(dem))[aoi_mask].mean()), 4)
    if cov < 1:
        warnings.append(f"DEM covers {cov} of the AOI")
    return Stack(sid, grid, course_xy, looks, dem, aoi_mask, fractions, cov, warnings)


def grid_hash(grid: Grid) -> str:
    key = repr((grid.crs, tuple(grid.transform)[:6], grid.width, grid.height))
    return hashlib.sha256(key.encode()).hexdigest()[:12]


def find_section_for(cfg: Config, region: str, grid: Grid, bbox: list[float] | None):
    """First section of the index whose pipeline cache is complete and holds `grid`:
    (sid, lock, window, section grid) or None."""
    ids, _ = load_index(region)
    index = json.loads((flow_dir(region) / "index.json").read_text())
    boxes = {s["id"]: s["bbox"] for r in index["rivers"] for s in r["sections"]}
    for sid in ids:
        sb = boxes.get(sid)
        if bbox and sb and (sb[2] < bbox[0] or sb[0] > bbox[2] or sb[3] < bbox[1] or sb[1] > bbox[3]):
            continue
        cache = _section_cache(region, sid)
        if not cache.is_dir():
            continue
        lock = _complete_lock(cfg, cache)
        if lock is None:
            continue
        sec_grid, _, _ = build_grid(cfg, load_course(region, sid)[0])
        win = _window(sec_grid, grid)
        if win is not None:
            return sid, lock, win, sec_grid
    return None


def load_stack(cfg: Config, region: str, grid: Grid, aoi, course_xy: np.ndarray,
               section: str | None, bbox: list[float] | None, reselect: bool) -> tuple[Stack, dict]:
    """Stack of the probe grid and the `source` record for the report."""
    if not reselect:
        hit = None
        if section is not None:
            lock = _complete_lock(cfg, _section_cache(region, section))
            if lock is not None:
                sec_grid, _, _ = build_grid(cfg, load_course(region, section)[0])
                win = _window(sec_grid, grid)
                hit = (section, lock, win) if win is not None else None
        else:
            found = find_section_for(cfg, region, grid, bbox)
            hit = found[:3] if found else None
        if hit is not None:
            sid, lock, win = hit
            cache = _section_cache(region, sid)
            log.info("source: pipeline cache of %s (read only)", sid)
            st = crop_pipeline_cache(cfg, region, sid, lock, win, grid, course_xy, aoi)
            return st, {"kind": "pipeline-cache", "section": sid,
                        "cacheDir": str(cache.relative_to(ROOT))}
    cache = probe_dir(region) / "cache" / grid_hash(grid)
    had = _complete_lock(cfg, cache) is not None
    log.info("source: probe cache %s (%s)", cache.name, "hit" if had and not reselect else "reads the network")
    st = acquire_on_grid(cfg, section or "probe", grid, course_xy, aoi, cache, reselect)
    return st, {"kind": "probe-cache" if had and not reselect else "fresh",
                "cacheDir": str(cache.relative_to(ROOT))}


# ---------------------------------------------------------------- truth

def truth_metrics(water: np.ndarray, truth_water: np.ndarray, truth_land: np.ndarray,
                  arm_samples: list[tuple[np.ndarray, np.ndarray]], res_m: float = 10.0) -> dict:
    """Score the final water mask against the owner's labels. TP = water on truth water, FN = no
    water on truth water, FP = water on truth land; IoU = TP / (TP + FP + FN), None when that is 0.
    `arm_samples` holds one (rows, cols) pair per arm (points every resolutionM / 2 along it); an
    arm is missed when under half of its points fall on water."""
    tp = int((water & truth_water).sum())
    fn = int((~water & truth_water).sum())
    fp = int((water & truth_land).sum())
    denom = tp + fp + fn
    km2 = res_m * res_m / 1e6
    arms = []
    for rows, cols in arm_samples:
        frac = float(water[rows, cols].mean()) if len(rows) else None
        arms.append({"fraction": None if frac is None else round(frac, 3),
                     "missed": None if frac is None else frac < 0.5})
    scored = [a for a in arms if a["fraction"] is not None]
    return {
        "tpPx": tp, "fpPx": fp, "fnPx": fn,
        "iou": round(tp / denom, 4) if denom else None,
        "fpKm2": round(fp * km2, 4), "fnKm2": round(fn * km2, 4),
        "armsTotal": len(scored), "armsMissed": sum(a["missed"] for a in scored), "arms": arms,
    }


def load_truth(path: Path, grid: Grid, res_m: float):
    """(truth_water, truth_land, arm_samples, meta) of a GeoJSON file in EPSG:4326."""
    fc = json.loads(path.read_text())
    tf = pyproj.Transformer.from_crs("EPSG:4326", grid.crs, always_xy=True).transform
    polys: dict[str, list] = {"water": [], "land": []}
    arms = []
    for i, f in enumerate(fc.get("features", [])):
        label = (f.get("properties") or {}).get("label")
        if label not in TRUTH_LABELS:
            _die(f"{path}: feature {i} has unknown label {label!r} (use water, land or arm)")
        g = f.get("geometry")
        if not g:
            _die(f"{path}: feature {i} has no geometry")
        if g["type"] not in TRUTH_LABELS[label]:
            _die(f"{path}: feature {i} label {label!r} needs {' or '.join(TRUTH_LABELS[label])}, got {g['type']}")
        geom = shp_transform(tf, shape(g))
        if label == "arm":
            arms.append(geom)
        else:
            polys[label].append((mapping(geom), 1))
    h, w = grid.height, grid.width

    def raster(shapes):
        if not shapes:
            return np.zeros((h, w), bool)
        return rasterize(shapes, out_shape=(h, w), transform=grid.transform, fill=0, dtype="uint8").astype(bool)

    samples, inside = [], []
    for geom in arms:
        parts = geom.geoms if hasattr(geom, "geoms") else [geom]
        pts = []
        for p in parts:
            n = max(int(p.length / (res_m / 2.0)), 1)
            pts += [p.interpolate(k * p.length / n) for k in range(n + 1)]
        xy = np.array([[p.x, p.y] for p in pts])
        rc = xy_to_rc(xy, grid.transform)
        r, c = np.floor(rc[:, 0] + 0.5).astype(int), np.floor(rc[:, 1] + 0.5).astype(int)
        ok = (r >= 0) & (r < h) & (c >= 0) & (c < w)
        samples.append((r[ok], c[ok]))
        inside.append(round(float(ok.mean()), 3))
    meta = {k: (fc.get("properties") or {}).get(k, fc.get(k)) for k in ("drawnOn", "drawnBy", "date")}
    tw, tl = raster(polys["water"]), raster(polys["land"])
    # Overlapping water and land labels count a pixel as both TP/FN and FP: reported, not fixed.
    meta["overlapPx"] = int((tw & tl).sum())
    if meta["overlapPx"]:
        log.warning("%s: %d px labelled both water and land", path.name, meta["overlapPx"])
    # Share of each arm's sample points inside the grid (only those are scored).
    meta["armsInsideGrid"] = inside
    return tw, tl, samples, meta


# ---------------------------------------------------------------- stages

def course_for(region: str, cfg: Config, section: str, grid: Grid, clip: bool) -> np.ndarray | None:
    """Course of a section in the grid CRS; clipped to the grid box (longest piece) when `clip`."""
    lonlat, _ = load_course(region, section)
    tf = pyproj.Transformer.from_crs("EPSG:4326", cfg.crs, always_xy=True)
    x, y = tf.transform(lonlat[:, 0], lonlat[:, 1])
    line = LineString(np.column_stack([x, y]))
    if not clip:
        return np.asarray(line.coords)
    from rasterio.transform import array_bounds
    piece = line.intersection(box(*array_bounds(grid.height, grid.width, grid.transform)))
    if piece.is_empty:
        return None
    lines = [g for g in getattr(piece, "geoms", [piece]) if isinstance(g, LineString) and g.length > 0]
    return np.asarray(max(lines, key=lambda g: g.length).coords) if lines else None


def run_stages(cfg: Config, stack: Stack, course_xy: np.ndarray | None) -> dict:
    """The stages of build_water (same functions, same order) and, with a course, build_network."""
    w, rv, r = cfg.water, cfg.reservoir, cfg.resolution_m
    g = stack.grid
    n_water, n_valid = water_frequency(cfg, stack)
    freq = np.where(n_valid > 0, n_water / np.maximum(n_valid, 1), 0).astype(np.float32)
    thr = (freq >= w.min_freq) & (n_valid >= w.min_valid_looks)
    closed = close_padded(thr, w.closing_px)
    filled = fill_small_holes(closed, w.min_island_m2, r)
    if course_xy is not None:
        corridor = rasterize([(mapping(LineString(course_xy).buffer(w.keep_corridor_m)), 1)],
                             out_shape=(g.height, g.width), transform=g.transform, fill=0,
                             dtype="uint8").astype(bool)
        kept = keep_corridor_components(filled, corridor, r)[0]
    else:
        kept = filled
    edt_m = edt_metres(kept, r)
    zone = reservoir_zone(kept, edt_m, r, rv.min_half_width_m, rv.min_area_km2)
    channel = kept & ~zone
    skeleton = skeletonise(channel, kept)
    out = {"nValid": n_valid, "freq": freq, "thr": thr, "closed": closed, "filled": filled,
           "kept": kept, "zone": zone, "channel": channel, "skeleton": skeleton, "network": None}
    if course_xy is not None:
        st = Stack(stack.section_id, g, course_xy, stack.looks, stack.dem, stack.aoi_mask)
        reservoirs = vectorise_zones(zone, g.transform, course_xy, rv.simplify_m, w.min_island_m2)
        wr = WaterResult(freq, n_valid, kept, channel, zone, edt_m, reservoirs)
        try:
            out["network"] = build_network(cfg, st, wr)
        except Exception as e:  # a partial box can break terminals or ports: report, do not stop
            log.warning("build_network failed: %s: %s", type(e).__name__, e)
            out["networkError"] = f"{type(e).__name__}: {e}"
    return out


# ---------------------------------------------------------------- rendering

def _png(rgba: np.ndarray) -> str:
    buf = io.BytesIO()
    Image.fromarray(np.ascontiguousarray(rgba), "RGBA").save(buf, format="PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def mask_png(mask: np.ndarray, rgb: tuple[int, int, int], alpha: int = 190) -> str:
    out = np.zeros(mask.shape + (4,), np.uint8)
    out[mask] = (*rgb, alpha)
    return _png(out)


def cmap_png(values: np.ndarray, vmin: float, vmax: float, cmap: str, show: np.ndarray) -> str:
    """Continuous layer through a matplotlib colormap, quantised to LEVELS colours (a palette PNG,
    index 0 transparent) so noisy layers stay small; transparent where `show` is False or NaN."""
    from matplotlib import colormaps
    v = np.nan_to_num(np.clip((values - vmin) / (vmax - vmin), 0, 1), nan=0.0)
    idx = (1 + np.minimum((v * LEVELS).astype(np.uint8), LEVELS - 1)).astype(np.uint8)
    idx[~(show & np.isfinite(values))] = 0
    pal = (colormaps[cmap]((np.arange(LEVELS) + 0.5) / LEVELS)[:, :3] * 255).astype(np.uint8)
    img = Image.fromarray(idx, "P")
    img.putpalette([0, 0, 0, *pal.ravel().tolist()])
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True, transparency=0)
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def false_colour_png(look: Look) -> str:
    """R swir16, G nir, B green, reflectance 0..STRETCH (JPEG: the base layer only)."""
    ch = [np.nan_to_num(np.clip(look.bands[n] / STRETCH, 0, 1), nan=0.0) for n in ("swir16", "nir", "green")]
    rgb = (np.stack(ch, axis=-1) * 255).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(rgb, "RGB").save(buf, format="JPEG", quality=85)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def network_layers(net, skeleton: np.ndarray, t) -> tuple[np.ndarray, np.ndarray]:
    """(branch layer RGBA, pruned skeleton mask): branches drawn as lines in pixel coords; skeleton
    pixels farther than 2 px from every branch are 'pruned' (the branches are smoothed)."""
    h, w = skeleton.shape
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ink = Image.new("L", (w, h), 0)
    d, di = ImageDraw.Draw(img), ImageDraw.Draw(ink)
    for b in net.branches:
        rc = xy_to_rc(b.xy, t)
        pts = [(float(c) + 0.5, float(r) + 0.5) for r, c in rc]
        d.line(pts, fill=(255, 210, 0, 255) if b.kind == "channel" else (255, 120, 0, 255), width=1)
        di.line(pts, fill=255, width=1)
    covered = ndimage.binary_dilation(np.asarray(ink) > 0, iterations=2)
    return np.asarray(img), skeleton & ~covered


def layer_defs(has_course: bool, n_looks: int) -> list[dict]:
    kept_label = "corridor-kept components" if has_course else "all components (no course)"
    return [
        {"name": "invalid", "label": f"invalid looks count (SCL not valid or no data, of {n_looks})", "area": False},
        {"name": "freq", "label": "water frequency (0..1)", "area": False},
        {"name": "thr", "label": "threshold mask (freq and valid looks)", "area": True},
        {"name": "closed", "label": "closed", "area": True},
        {"name": "filled", "label": "holes filled", "area": True},
        {"name": "kept", "label": kept_label, "area": True},
        {"name": "zone", "label": "reservoir zones", "area": True},
        {"name": "channel", "label": "channel (water without zones)", "area": True},
        {"name": "skeleton", "label": "skeleton", "area": False},
        {"name": "pruned", "label": "skeleton not under a final branch (approx., > 2 px from the smoothed branches)", "area": False},
        {"name": "network", "label": "network branches (channel, connector)", "area": False},
        {"name": "truth", "label": "truth (water, land, arm)", "area": False},
    ]


def render_variant(stages: dict, cfg: Config, truth_png: str | None) -> tuple[dict, dict]:
    """(images by layer name, areas km2 by layer name) of one variant."""
    r = cfg.resolution_m
    km2 = r * r / 1e6
    imgs, areas = {}, {}
    imgs["freq"] = cmap_png(stages["freq"], 0.0, 1.0, "viridis", stages["nValid"] > 0)
    imgs["thr"] = mask_png(stages["thr"], (0, 200, 255))
    imgs["closed"] = mask_png(stages["closed"], (60, 90, 255))
    imgs["filled"] = mask_png(stages["filled"], (150, 80, 255))
    imgs["kept"] = mask_png(stages["kept"], (0, 120, 255))
    imgs["zone"] = mask_png(stages["zone"], (0, 220, 120))
    imgs["channel"] = mask_png(stages["channel"], (255, 255, 255), 150)
    imgs["skeleton"] = mask_png(stages["skeleton"], (255, 60, 220), 255)
    for k in ("thr", "closed", "filled", "kept", "zone", "channel"):
        areas[k] = round(float(stages[k].sum()) * km2, 3)
    net = stages["network"]
    if net is not None:
        lay, pruned = network_layers(net, stages["skeleton"], stages["grid"].transform)
        imgs["network"] = _png(lay)
        imgs["pruned"] = mask_png(pruned, (255, 40, 40), 255)
    if truth_png:
        imgs["truth"] = truth_png
    return imgs, areas


def truth_png(tw: np.ndarray, tl: np.ndarray, arm_samples) -> str:
    out = np.zeros(tw.shape + (4,), np.uint8)
    out[tl] = (255, 70, 70, 120)
    out[tw] = (60, 255, 90, 120)
    for rows, cols in arm_samples:
        out[rows, cols] = (255, 0, 255, 255)
    return _png(out)


# ---------------------------------------------------------------- html

PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>flow-water probe: %(title)s</title>
<style>
body{font:13px system-ui,sans-serif;margin:12px;background:#111;color:#ddd}
h1{font-size:16px}h2{font-size:14px;margin:14px 0 4px}
table{border-collapse:collapse;margin:4px 0}td,th{border:1px solid #444;padding:2px 6px;text-align:left}
#layout{display:flex;gap:16px;align-items:flex-start}#ctl{min-width:360px}
.row{display:grid;grid-template-columns:18px 90px 1fr;gap:4px;align-items:center;margin:2px 0}
.row small{grid-column:3;color:#999}
#panels{display:flex;flex-wrap:wrap;gap:12px}.panel h3{font-size:13px;margin:0 0 4px}
.stack{position:relative;background:#000}.stack img{position:absolute;left:0;top:0;width:100%%;height:100%%;image-rendering:pixelated}
pre{background:#1b1b1b;padding:6px;overflow:auto;max-height:260px}
</style></head><body>
<h1>flow-water probe: %(title)s</h1>
<div id="layout"><div id="ctl">
<div>Base look (false colour: R swir16, G nir, B green, reflectance 0 to %(stretch)s): <select id="base"></select></div>
<div>Zoom: <select id="zoom"></select></div>
<h2>Layers</h2><div id="layers"></div>
</div><div id="panels"></div></div>
%(tables)s
<script type="application/json" id="data">%(data)s</script>
<script>
const D=JSON.parse(document.getElementById('data').textContent);
const panels=document.getElementById('panels'),layers=document.getElementById('layers');
const base=document.getElementById('base'),zoom=document.getElementById('zoom');
D.looks.forEach(l=>base.add(new Option(l,l)));
const zs=[1,2,3,4,6,8];zs.forEach(z=>zoom.add(new Option(z+'x',z)));
const want=Math.floor(1100/(D.variants.length*D.w));
zoom.value=zs.filter(z=>z<=want).pop()||1;
const state={};
function key(L,i){return L.shared?L.name:'v'+i+':'+L.name}
D.layers.forEach(L=>{
  const row=document.createElement('div');row.className='row';
  const cb=document.createElement('input');cb.type='checkbox';cb.checked=!!L.on;
  const sl=document.createElement('input');sl.type='range';sl.min=0;sl.max=100;sl.value=L.opacity||80;
  const lb=document.createElement('span');lb.textContent=L.label;
  const sm=document.createElement('small');sm.textContent=L.areas||'';
  row.append(cb,sl,lb,sm);layers.append(row);state[L.name]={cb,sl};
  cb.onchange=sl.oninput=apply;
});
D.variants.forEach((v,i)=>{
  const p=document.createElement('div');p.className='panel';
  p.innerHTML='<h3></h3><div class="stack"></div>';p.querySelector('h3').textContent=v;
  const st=p.querySelector('.stack');
  const b=document.createElement('img');b.className='baseimg';st.append(b);
  D.layers.forEach(L=>{const k=key(L,i);if(!(k in D.images))return;
    const im=document.createElement('img');im.src=D.images[k];im.dataset.layer=L.name;st.append(im)});
  panels.append(p);
});
function apply(){
  const z=+zoom.value;
  document.querySelectorAll('.stack').forEach(s=>{s.style.width=D.w*z+'px';s.style.height=D.h*z+'px'});
  document.querySelectorAll('.baseimg').forEach(b=>{b.src=D.images['rgb:'+base.value]});
  document.querySelectorAll('.stack img[data-layer]').forEach(im=>{
    const s=state[im.dataset.layer];im.style.display=s.cb.checked?'block':'none';im.style.opacity=s.sl.value/100});
}
base.onchange=zoom.onchange=apply;apply();
</script></body></html>
"""


def _table(rows: list[list], head: list[str] | None = None) -> str:
    esc = lambda v: html.escape("" if v is None else str(v))
    h = "<tr>" + "".join(f"<th>{esc(c)}</th>" for c in head) + "</tr>" if head else ""
    return "<table>" + h + "".join("<tr>" + "".join(f"<td>{esc(c)}</td>" for c in r) + "</tr>" for r in rows) + "</table>"


def build_html(title: str, grid: Grid, look_dates: list[str], shared: dict, variants: list[dict],
               layers: list[dict], report: dict) -> str:
    images = dict(shared)
    for i, v in enumerate(variants):
        for name, uri in v["images"].items():
            images[f"v{i}:{name}"] = uri
    lay = []
    for L in layers:
        areas = " | ".join("-" if v["areas"].get(L["name"]) is None else f"{v['areas'][L['name']]} km2"
                           for v in variants) if L.get("area") else ""
        lay.append({**L, "areas": areas, "on": L["name"] in ("kept", "network", "truth"),
                    "opacity": 80, "shared": L["name"].startswith(("mndwi:", "ndvi:"))})
    data = {"w": grid.width, "h": grid.height, "looks": look_dates, "images": images,
            "layers": lay, "variants": [v["label"] for v in variants]}
    m_rows = []
    for v in report["variants"]:
        t = v.get("truth")
        net = v.get("network")
        m_rows.append([v["label"], v["stagesKm2"]["kept"], v["skeletonPx"],
                       (net or {}).get("branches", (net or {}).get("error", "-")) if net is not None else "-",
                       "-" if t is None else t["iou"], "-" if t is None else t["fpKm2"],
                       "-" if t is None else t["fnKm2"],
                       "-" if t is None else f"{t['armsMissed']}/{t['armsTotal']}"])
    tables = "<h2>Metrics</h2>" + _table(
        m_rows, ["variant", "kept km2", "skeleton px", "branches", "IoU", "FP km2", "FN km2", "arms missed"])
    tables += "<h2>Stage areas (km2)</h2>" + _table(
        [[v["label"], *[v["stagesKm2"][k] for k in ("threshold", "closed", "filled", "kept", "zone", "channel")]]
         for v in report["variants"]], ["variant", "threshold", "closed", "filled", "kept", "zone", "channel"])
    tables += "<h2>Source and looks</h2>" + _table(
        [["source", json.dumps(report["source"], sort_keys=True)], ["region", report["region"]],
         ["bbox", json.dumps(report["bbox"])], ["course", "yes" if report["course"] else "no"],
         ["grid", f"{grid.width} x {grid.height} px, {grid.crs}"]])
    tables += _table([[lk["date"], ", ".join(lk["itemIds"]), lk["validFraction"]] for lk in report["looks"]],
                     ["look", "items", "valid fraction"])
    tables += "<h2>Config overrides</h2><pre>" + html.escape(json.dumps(report["overrides"], indent=1, sort_keys=True)) + "</pre>"
    tables += "<h2>Config used (base)</h2><pre>" + html.escape(json.dumps(report["config"], indent=1, sort_keys=True)) + "</pre>"
    if report.get("truth"):
        tables += "<h2>Truth</h2><pre>" + html.escape(json.dumps(report["truth"], indent=1, sort_keys=True)) + "</pre>"
    payload = json.dumps(data, separators=(",", ":")).replace("</", "<\\/")
    return PAGE % {"title": html.escape(title), "stretch": STRETCH, "tables": tables, "data": payload}


# ---------------------------------------------------------------- entry

def config_dict(cfg: Config) -> dict:
    from dataclasses import asdict
    return json.loads(json.dumps(asdict(cfg), sort_keys=True))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="flowwater-probe", description=__doc__.strip().splitlines()[0])
    ap.add_argument("--region", required=True)
    target = ap.add_mutually_exclusive_group()
    target.add_argument("--case", help="name in regions/<id>/flow-water.cases.json")
    target.add_argument("--bbox", help="lon1,lat1,lon2,lat2")
    target.add_argument("--at", help='MapLibre URL fragment #zoom/lat/lon or "z/lat/lon"')
    ap.add_argument("--size-km", type=float, default=3.0, help="side of the --at square (default 3)")
    ap.add_argument("--section", help="section id: the pipeline grid, or the course of a bbox run")
    ap.add_argument("--set", action="append", default=[], metavar="KEY=VALUE", help="config override (dotted key)")
    ap.add_argument("--sweep", metavar="KEY=A,B,C", help="run the stages once per value of one key")
    ap.add_argument("--truth", help="truth GeoJSON (EPSG:4326; labels water, land, arm)")
    ap.add_argument("--reselect", action="store_true", help="redo the STAC search of a probe-cache run")
    args = ap.parse_args(argv)
    t0 = time.monotonic()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", stream=sys.stdout)
    logging.getLogger("rasterio").setLevel(logging.WARNING)

    region = args.region
    case = load_case(region, args.case) if args.case else {}
    section = args.section or case.get("section")
    overrides = parse_overrides(args.set)
    cfg = load_config(region, overrides)

    bbox = None
    if args.bbox:
        bbox = parse_bbox(args.bbox)
    elif args.at:
        lat, lon = parse_at(args.at)
        bbox = bbox_at(cfg, lat, lon, args.size_km)
    elif not args.case and section is None:
        _die("give one of --case, --bbox, --at or --section")
    elif case.get("bbox"):
        bbox = [float(v) for v in case["bbox"]]
    if bbox is None and section is None:
        _die("a bbox or a section is needed (the case has neither)")
    if args.case:
        name = args.case
    elif bbox is not None:
        name = bbox_name(bbox)
    else:
        name = section

    # grid, aoi and course
    if section is not None and section not in load_index(region)[0]:
        _die(f"unknown section {section!r}")
    if bbox is None:
        lonlat, _ = load_course(region, section)
        grid, course_xy, aoi = build_grid(cfg, lonlat)
    else:
        grid, aoi = grid_from_bbox(cfg, bbox)
        course_xy = course_for(region, cfg, section, grid, clip=True) if section else None
    stack, source = load_stack(cfg, region, grid, aoi,
                               course_xy if course_xy is not None else np.empty((0, 2)),
                               section, bbox, args.reselect)
    if not stack.looks:
        _die("no looks available for this grid")

    # variants
    sweep_key, sweep_vals = parse_sweep(args.sweep) if args.sweep else (None, [None])
    variants_in = [({**overrides, sweep_key: v} if sweep_key else overrides,
                    f"{sweep_key}={json.dumps(v)}" if sweep_key else "base") for v in sweep_vals]

    # truth
    truth_path = Path(args.truth) if args.truth else (
        cases_dir(region) / case["truth"] if case.get("truth") else None)
    tw = tl = None
    samples, truth_meta, tpng = [], None, None
    if truth_path is not None:
        if not truth_path.is_file():
            _die(f"truth file {truth_path} not found")
        tw, tl, samples, truth_meta = load_truth(truth_path, grid, cfg.resolution_m)
        tpng = truth_png(tw, tl, samples)

    shared = {}
    for lk in stack.looks:
        shared[f"rgb:{lk.date}"] = false_colour_png(lk)
        mndwi, ndvi, valid, _ = look_indices(cfg, lk)
        shared[f"mndwi:{lk.date}"] = cmap_png(mndwi, -1, 1, "RdBu", valid)
        shared[f"ndvi:{lk.date}"] = cmap_png(ndvi, -1, 1, "RdBu", valid)

    out_variants, rep_variants = [], []
    for ov, label in variants_in:
        vcfg = cfg if ov is overrides else load_config(region, ov)
        stages = run_stages(vcfg, stack, course_xy)
        stages["grid"] = grid
        imgs, areas = render_variant(stages, vcfg, tpng)
        n_looks = len(stack.looks)
        imgs["invalid"] = cmap_png((n_looks - stages["nValid"]).astype(np.float32), 0, n_looks,
                                   "Oranges", stages["nValid"] < n_looks)
        km2 = vcfg.resolution_m ** 2 / 1e6
        net = stages["network"]
        rv = {
            "label": label,
            "overrides": ov,
            "stagesKm2": {"threshold": areas["thr"], "closed": areas["closed"], "filled": areas["filled"],
                          "kept": areas["kept"], "zone": areas["zone"], "channel": areas["channel"]},
            "skeletonPx": int(stages["skeleton"].sum()),
            "network": net.stats if net is not None else (
                {"error": stages["networkError"]} if "networkError" in stages else None),
        }
        if tw is not None:
            rv["truth"] = truth_metrics(stages["kept"], tw, tl, samples, vcfg.resolution_m)
        rep_variants.append(rv)
        out_variants.append({"label": label, "images": imgs, "areas": {
            "thr": areas["thr"], "closed": areas["closed"], "filled": areas["filled"],
            "kept": areas["kept"], "zone": areas["zone"], "channel": areas["channel"]}})
        log.info("%s: kept %.3f km2, skeleton %d px, network %s", label, areas["kept"], rv["skeletonPx"],
                 "-" if rv["network"] is None else rv["network"].get("branches", rv["network"]))

    layers = layer_defs(course_xy is not None, len(stack.looks))
    look_layers = [{"name": f"{k}:{lk.date}", "label": f"{k.upper()} {lk.date}", "area": False}
                   for lk in stack.looks for k in ("mndwi", "ndvi")]
    report = {
        "region": region,
        "case": name,
        "bbox": bbox if bbox is not None else [round(v, 6) for v in grid_lonlat_bbox(grid)],
        "section": section,
        "course": course_xy is not None,
        "grid": {"crs": grid.crs, "height": grid.height, "width": grid.width,
                 "resolutionM": cfg.resolution_m},
        "source": source,
        "looks": [{"date": lk.date, "itemIds": lk.item_ids, "validFraction": f}
                  for lk, f in zip(stack.looks, stack.look_valid_fraction)],
        "overrides": overrides,
        "sweep": None if sweep_key is None else {"key": sweep_key, "values": sweep_vals},
        "config": config_dict(cfg),
        "variants": rep_variants,
        "truth": None if truth_meta is None else {"file": truth_path.name, **truth_meta},
        "warnings": stack.warnings,
    }
    outdir = probe_dir(region) / name
    page = build_html(f"{region} / {name}", grid, [lk.date for lk in stack.looks], shared, out_variants,
                      look_layers + layers, report)
    _write(outdir / "index.html", page.encode())
    report["lastRun"] = {"elapsedS": round(time.monotonic() - t0, 1)}
    _write(outdir / "report.json", (json.dumps(report, indent=2, sort_keys=True) + "\n").encode())
    log.info("wrote %s (%d KB) in %.1f s", outdir / "index.html", len(page) // 1024, time.monotonic() - t0)
    return 0


if __name__ == "__main__":
    sys.exit(main())
