"""
Water mask of the flow-water step (F2.2): from a Stack, the water, its split into river
channel and reservoir zone, the reservoir polygons and a lake check.

1. Per look: water_look = SCL valid & MNDWI > mndwiMin & NDVI < ndviMax; water = frequency over
   the valid looks >= minFreq with >= minValidLooks valid looks.
2. Square closing (padded, so the AOI border is not eroded), small holes (islands, bars) filled,
   only 8-connected components touching the course corridor kept.
3. Reservoir zone = opening of the water by a disk of radius minHalfWidthM, done with distance
   transforms; zone components under minAreaKm2 stay channel. channel = water & ~zone.
4. Zone components are vectorised (ids r0, r1, ... by the course chainage they touch) and compared
   with HydroLAKES (data/work/<region>/lakes/lakes.geojson, provisional IoU).
5. out/<section>.water.tif: band 1 = frequency * 100 (255 = no valid looks), band 2 = class
   (0 land, 1 channel, 2 reservoir).
"""

from __future__ import annotations

import json
import logging
import math
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pyproj
import rasterio
from rasterio.features import rasterize, shapes
from scipy import ndimage
from shapely.geometry import LineString, Polygon, box, mapping, shape
from shapely.ops import transform as shp_transform
from shapely.ops import unary_union
from shapely.validation import make_valid
from skimage.morphology import remove_small_holes

from flowwater.acquire import BANDS, Stack
from flowwater.config import Config
from flowwater.paths import work_dir

log = logging.getLogger("flowwater")

EIGHT = np.ones((3, 3), bool)
CLASS_LAND, CLASS_CHANNEL, CLASS_RESERVOIR = 0, 1, 2


@dataclass
class WaterResult:
    freq: np.ndarray  # float32, water looks / valid looks (0 where none valid)
    valid_count: np.ndarray  # uint8
    water: np.ndarray  # bool
    channel: np.ndarray  # bool, water outside the reservoir zones
    zone: np.ndarray  # bool, reservoir zones (components >= reservoir.minAreaKm2)
    edt_m: np.ndarray  # float32, distance to the nearest non-water pixel, m
    reservoirs: list[tuple[str, Polygon]]  # grid CRS
    stats: dict = field(default_factory=dict)


# ---------------------------------------------------------------- mask

def _ratio(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """(a - b) / (a + b); NaN where the sum is not positive (no signal) or a band is NaN."""
    d = a + b
    with np.errstate(invalid="ignore", divide="ignore"):
        out = (a - b) / d
    return np.where(d > np.float32(1e-6), out, np.float32(np.nan)).astype(np.float32)


def water_frequency(cfg: Config, stack: Stack) -> tuple[np.ndarray, np.ndarray]:
    """(water looks, valid looks) per pixel, both uint8."""
    w = cfg.water
    shp = (stack.grid.height, stack.grid.width)
    n_water, n_valid = np.zeros(shp, np.uint8), np.zeros(shp, np.uint8)
    for lk in stack.looks:
        b = lk.bands
        mndwi = _ratio(b["green"], b["swir16"])
        ndvi = _ratio(b["nir"], b["red"])
        finite = np.isfinite(mndwi) & np.isfinite(ndvi)
        for n in BANDS:
            finite &= np.isfinite(b[n])
        valid = np.isin(lk.scl, w.scl_valid) & finite
        with np.errstate(invalid="ignore"):
            wet = valid & (mndwi > w.mndwi_min) & (ndvi < w.ndvi_max)
        n_valid += valid
        n_water += wet
    return n_water, n_valid


def close_padded(mask: np.ndarray, px: int) -> np.ndarray:
    """Binary closing with a px x px square; edge-padded so the array border is not eroded."""
    pad = px + 1
    p = np.pad(mask, pad, mode="edge")
    c = ndimage.binary_closing(p, structure=np.ones((px, px), bool))
    return c[pad:-pad, pad:-pad]


def fill_small_holes(mask: np.ndarray, max_m2: float, res_m: float) -> np.ndarray:
    """Fill enclosed non-water holes smaller than max_m2 (4-connected holes)."""
    max_px = math.ceil(max_m2 / (res_m * res_m)) - 1  # remove_small_holes fills size <= max_size
    if max_px < 1:
        return mask
    return remove_small_holes(mask, max_size=max_px, connectivity=1)


def keep_corridor_components(water: np.ndarray, corridor: np.ndarray, res_m: float):
    """Keep 8-connected components touching `corridor`; returns (mask, kept, dropped, dropped km2)."""
    lab, n = ndimage.label(water, structure=EIGHT)
    hit = np.zeros(n + 1, bool)
    hit[np.unique(lab[corridor & water])] = True
    hit[0] = False
    kept = int(hit.sum())
    dropped_px = int((water & ~hit[lab]).sum())
    return hit[lab], kept, n - kept, dropped_px * res_m * res_m / 1e6


def count_islands(water: np.ndarray) -> int:
    """Enclosed non-water components (4-connected, not touching the array border)."""
    lab, n = ndimage.label(~water)
    if n == 0:
        return 0
    border = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    return n - int((border > 0).sum())


# ---------------------------------------------------------------- reservoirs

def edt_metres(water: np.ndarray, res_m: float) -> np.ndarray:
    return (ndimage.distance_transform_edt(water) * res_m).astype(np.float32)


def reservoir_zone(water: np.ndarray, edt_m: np.ndarray, res_m: float, radius_m: float,
                   min_area_km2: float) -> np.ndarray:
    """Opening of water by a disk of radius_m (cores = deep water, regrown by radius_m)."""
    core = edt_m > radius_m
    if not core.any():
        return np.zeros_like(water)
    zone = (ndimage.distance_transform_edt(~core) * res_m <= radius_m) & water
    lab, n = ndimage.label(zone, structure=EIGHT)
    area_km2 = np.bincount(lab.ravel(), minlength=n + 1) * res_m * res_m / 1e6
    keep = area_km2 >= min_area_km2
    keep[0] = False
    return keep[lab]


def _chainage(course_xy: np.ndarray) -> np.ndarray:
    seg = np.hypot(*np.diff(course_xy, axis=0).T)
    return np.concatenate([[0.0], np.cumsum(seg)])


def vectorise_zones(zone: np.ndarray, grid_transform, course_xy: np.ndarray, simplify_m: float,
                    min_hole_m2: float) -> list[tuple[str, Polygon]]:
    """One polygon per zone component, ids r0.. by the chainage of the course vertex nearest
    the polygon centroid."""
    lab, _ = ndimage.label(zone, structure=EIGHT)
    chain = _chainage(course_xy)
    found = []
    for geom, val in shapes(lab.astype(np.int32), mask=zone, transform=grid_transform, connectivity=8):
        if val == 0:
            continue
        g = shape(geom).simplify(simplify_m, preserve_topology=True)
        if g.geom_type == "Polygon":
            g = Polygon(g.exterior, [r for r in g.interiors if Polygon(r).area >= min_hole_m2])
        g = make_valid(g)
        c = g.centroid
        near = int(np.argmin(np.hypot(course_xy[:, 0] - c.x, course_xy[:, 1] - c.y)))
        found.append((chain[near], g.bounds, g))
    found.sort(key=lambda t: (t[0], t[1]))
    return [(f"r{i}", g) for i, (_, _, g) in enumerate(found)]


# ---------------------------------------------------------------- lakes

def lake_check(cfg: Config, region: str, stack: Stack, reservoirs: list[tuple[str, Polygon]]):
    """(IoU or None, [{id, name}], warnings) of the reservoir polygons vs HydroLAKES in the AOI."""
    path = work_dir(region).parent / "lakes" / "lakes.geojson"
    if not path.is_file():
        return None, [], [f"{path} not found: lakeIoU not computed"]
    g = stack.grid
    foot = LineString(stack.course_xy).buffer(cfg.corridor_m).intersection(
        box(*rasterio.transform.array_bounds(g.height, g.width, g.transform)))
    tf = pyproj.Transformer.from_crs("EPSG:4326", g.crs, always_xy=True).transform
    lakes = []
    for f in json.loads(path.read_text())["features"]:
        poly = shp_transform(tf, shape(f["geometry"])).buffer(0)
        if poly.intersects(foot):
            p = f["properties"]
            lakes.append((p["id"], p.get("name"), poly))
    lakes.sort(key=lambda t: t[0])
    lake_u = unary_union([p for _, _, p in lakes]).intersection(foot) if lakes else Polygon()
    res_u = unary_union([p for _, p in reservoirs]).intersection(foot) if reservoirs else Polygon()
    union = lake_u.union(res_u).area
    iou = round(lake_u.intersection(res_u).area / union, 3) if union > 0 else None
    return iou, [{"id": i, "name": n} for i, n, _ in lakes], []


# ---------------------------------------------------------------- output

def write_tif(path: Path, res: WaterResult, stack: Stack) -> None:
    g = stack.grid
    b1 = np.rint(res.freq * 100).astype(np.uint8)
    b1[res.valid_count == 0] = 255
    b2 = np.full(b1.shape, CLASS_LAND, np.uint8)
    b2[res.channel] = CLASS_CHANNEL
    b2[res.zone] = CLASS_RESERVOIR
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    with rasterio.open(tmp, "w", driver="GTiff", height=g.height, width=g.width, count=2,
                       dtype="uint8", crs=g.crs, transform=g.transform, compress="deflate",
                       nodata=None) as dst:
        dst.write(b1, 1)
        dst.write(b2, 2)
    tmp.replace(path)


# ---------------------------------------------------------------- entry

def build_water(cfg: Config, region: str, stack: Stack) -> WaterResult:
    w, rv, r = cfg.water, cfg.reservoir, cfg.resolution_m
    g = stack.grid
    n_water, n_valid = water_frequency(cfg, stack)
    freq = np.where(n_valid > 0, n_water / np.maximum(n_valid, 1), 0).astype(np.float32)
    water = (freq >= w.min_freq) & (n_valid >= w.min_valid_looks)
    water = close_padded(water, w.closing_px)
    water = fill_small_holes(water, w.min_island_m2, r)
    corridor = rasterize([(mapping(LineString(stack.course_xy).buffer(w.keep_corridor_m)), 1)],
                         out_shape=(g.height, g.width), transform=g.transform, fill=0,
                         dtype="uint8").astype(bool)
    water, kept, dropped, dropped_km2 = keep_corridor_components(water, corridor, r)

    edt_m = edt_metres(water, r)
    zone = reservoir_zone(water, edt_m, r, rv.min_half_width_m, rv.min_area_km2)
    channel = water & ~zone
    reservoirs = vectorise_zones(zone, g.transform, stack.course_xy, rv.simplify_m, w.min_island_m2)
    iou, lakes, warns = lake_check(cfg, region, stack, reservoirs)
    stack.warnings.extend(warns)

    km2 = r * r / 1e6
    stats = {
        "waterKm2": round(float(water.sum()) * km2, 3),
        "channelKm2": round(float(channel.sum()) * km2, 3),
        "reservoirKm2": round(float(zone.sum()) * km2, 3),
        "islands": count_islands(water),
        "componentsKept": kept,
        "componentsDropped": dropped,
        "droppedKm2": round(dropped_km2, 3),
        "reservoirs": [{"id": i, "areaKm2": round(p.area / 1e6, 3)} for i, p in reservoirs],
        "lakeIoU": iou,
        "lakes": lakes,
    }
    return WaterResult(freq, n_valid, water, channel, zone, edt_m, reservoirs, stats)


def run_water(cfg: Config, region: str, stack: Stack) -> WaterResult:
    res = build_water(cfg, region, stack)
    write_tif(work_dir(region) / "out" / f"{stack.section_id}.water.tif", res, stack)
    return res
