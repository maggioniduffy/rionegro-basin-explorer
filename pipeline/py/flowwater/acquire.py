"""
Acquisition of the flow-water step (F2.1): for one flow section, Sentinel-2 L2A looks and the
Copernicus GLO-30 DEM on one UTM grid around the section's IGN course.

1. Grid: the course (public/flow/<region>/<section>.json stations, source to mouth) is projected
   to config.crs, buffered by corridorM, and its bounds are snapped outward to multiples of
   resolutionM.
2. Scenes: Earth Search STAC search on the AOI, items grouped by UTC acquisition date into
   "looks" (items of one date are mosaicked), ranked by mean cloud cover, then date, then id;
   the first `looks` are pinned in cache/<section>/scenes.lock.json with each asset's href and
   raster:bands scale/offset/nodata as the item states them (the offset is zeroed when the item
   says earthsearch:boa_offset_applied, see _asset_info). A lock is reused without searching
   until --reselect.
3. Reads: WarpedVRT onto the grid (bilinear for the reflectance bands, nearest for SCL), raw
   uint16 DN + uint8 SCL cached in look-<date>.npz; reflectance() converts with the locked
   scale/offset. The DEM tiles go to dem.npz; a missing tile is a warning.
"""

from __future__ import annotations

import json
import logging
import math
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pyproj
import rasterio
from affine import Affine
from pystac_client import Client
from rasterio.enums import Resampling
from rasterio.errors import RasterioIOError
from rasterio.features import rasterize
from rasterio.vrt import WarpedVRT
from shapely.geometry import LineString, mapping

from flowwater.config import Config
from flowwater.paths import flow_dir, work_dir

log = logging.getLogger("flowwater")

# Reflectance bands read from each item (SWIR is 20 m native: the MNDWI edge is effectively 20 m).
BANDS = ("green", "red", "nir", "swir16")
ASSETS = BANDS + ("scl",)

GDAL_ENV = {
    "AWS_NO_SIGN_REQUEST": "YES",
    "GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR",
    "GDAL_HTTP_MAX_RETRY": "4",
    "GDAL_HTTP_RETRY_DELAY": "1",
}


@dataclass
class Grid:
    crs: str
    transform: Affine
    width: int
    height: int


@dataclass
class Look:
    date: str
    item_ids: list[str]
    bands: dict[str, np.ndarray]  # float32 reflectance, NaN where no data
    scl: np.ndarray  # uint8, 0 = no data


@dataclass
class Stack:
    section_id: str
    grid: Grid
    course_xy: np.ndarray  # (N, 2) in grid.crs
    looks: list[Look]
    dem: np.ndarray  # float32, NaN where missing
    # report fields
    aoi_mask: np.ndarray = field(repr=False, default=None)  # bool, corridor buffer on the grid
    look_valid_fraction: list[float] = field(default_factory=list)
    dem_coverage: float = 0.0
    warnings: list[str] = field(default_factory=list)


def reflectance(dn: np.ndarray, scale: float, offset: float, nodata: int = 0) -> np.ndarray:
    """DN -> float32 reflectance, NaN where dn == nodata."""
    out = dn.astype(np.float32) * np.float32(scale) + np.float32(offset)
    out[dn == nodata] = np.nan
    return out


# ---------------------------------------------------------------- grid

def load_course(region: str, section_id: str) -> tuple[np.ndarray, list[float]]:
    d = json.loads((flow_dir(region) / f"{section_id}.json").read_text())
    st = d["stations"]
    lonlat = np.column_stack([st["lon"], st["lat"]]).astype(float)
    return lonlat, d["bbox"]


def build_grid(cfg: Config, lonlat: np.ndarray) -> tuple[Grid, np.ndarray, LineString]:
    tf = pyproj.Transformer.from_crs("EPSG:4326", cfg.crs, always_xy=True)
    x, y = tf.transform(lonlat[:, 0], lonlat[:, 1])
    course_xy = np.column_stack([x, y])
    aoi = LineString(course_xy).buffer(cfg.corridor_m)
    r = cfg.resolution_m
    minx, miny, maxx, maxy = aoi.bounds
    minx, miny = math.floor(minx / r) * r, math.floor(miny / r) * r
    maxx, maxy = math.ceil(maxx / r) * r, math.ceil(maxy / r) * r
    width, height = round((maxx - minx) / r), round((maxy - miny) / r)
    transform = Affine(r, 0, minx, 0, -r, maxy)
    return Grid(cfg.crs, transform, width, height), course_xy, aoi


def grid_lonlat_bbox(grid: Grid) -> list[float]:
    b = rasterio.transform.array_bounds(grid.height, grid.width, grid.transform)  # w, s, e, n
    return list(pyproj.Transformer.from_crs(grid.crs, "EPSG:4326", always_xy=True)
                .transform_bounds(b[0], b[1], b[2], b[3]))


# ---------------------------------------------------------------- scenes

def _asset_info(item, name: str) -> dict:
    a = item.assets[name]
    info = {"href": a.href}
    if name == "scl":
        return info
    rb = (a.extra_fields.get("raster:bands") or [{}])[0]
    if "scale" in rb and "offset" in rb:
        # Earth Search re-harmonises baseline >= 04.00 COGs and says so with
        # earthsearch:boa_offset_applied, but raster:bands still lists the -0.1 offset. Adding it
        # again puts open water below 0 (green about -0.05, SWIR -0.08), so it is dropped here.
        applied = item.properties.get("earthsearch:boa_offset_applied") is True
        info.update(scale=rb["scale"], offset=0 if applied else rb["offset"],
                    nodata=rb.get("nodata", 0), metaOffset=rb["offset"], boaOffsetApplied=applied)
        return info
    baseline = str(item.properties.get("s2:processing_baseline", ""))
    if baseline and baseline < "04.00":
        log.warning("%s %s: no raster:bands, using scale 0.0001 offset 0 (baseline %s)",
                    item.id, name, baseline)
        info.update(scale=0.0001, offset=0, nodata=0)
        return info
    raise ValueError(f"{item.id} {name}: no raster:bands scale/offset and baseline {baseline!r} >= 04.00")


def select_scenes(cfg: Config, bbox: list[float]) -> dict:
    """STAC search -> lock dict (deterministic: items by id, looks by cloud/date/id)."""
    s = cfg.stac
    query = {"eo:cloud_cover": {"lt": s.max_cloud_pct}}
    client = Client.open(s.url)
    items = sorted(client.search(collections=[s.collection], bbox=bbox, datetime=s.datetime,
                                 query=query).items(), key=lambda i: i.id)
    by_date: dict[str, list] = {}
    for it in items:
        by_date.setdefault(it.datetime.astimezone(timezone.utc).date().isoformat(), []).append(it)
    ranked = sorted(by_date.items(), key=lambda kv: (
        sum(i.properties.get("eo:cloud_cover", 100) for i in kv[1]) / len(kv[1]), kv[0],
        kv[1][0].id))
    looks, skipped = [], []
    for date, its in ranked:
        if len(looks) >= s.looks:
            break
        try:
            entries = [{"id": i.id, "cloudCover": i.properties.get("eo:cloud_cover"),
                        "assets": {n: _asset_info(i, n) for n in ASSETS}} for i in its]
        except ValueError as e:
            log.warning("look %s skipped: %s", date, e)
            skipped.append(date)
            continue
        looks.append({"date": date, "items": entries})
    return {
        "query": {"url": s.url, "collection": s.collection, "bbox": bbox, "datetime": s.datetime,
                  "query": query, "looks": s.looks},
        "selectedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "candidates": len(items),
        "skippedLooks": skipped,
        "looks": looks,
    }


def check_lock(cfg: Config, lock: dict) -> None:
    """Fail when the search settings differ from the ones the lock was made with (locks written
    before `looks` was stored are compared without it)."""
    s, q = cfg.stac, lock["query"]
    now = {"url": s.url, "collection": s.collection, "datetime": s.datetime,
           "maxCloud": s.max_cloud_pct, "looks": s.looks}
    then = {"url": q.get("url"), "collection": q.get("collection"), "datetime": q.get("datetime"),
            "maxCloud": q.get("query", {}).get("eo:cloud_cover", {}).get("lt"), "looks": q.get("looks")}
    if q.get("looks") is None:
        now.pop("looks")
        then.pop("looks")
    if now != then:
        raise ValueError("config changed since the scene lock; rerun with --reselect")


def get_lock(cfg: Config, cache: Path, bbox: list[float], reselect: bool) -> dict:
    path = cache / "scenes.lock.json"
    if path.is_file() and not reselect:
        lock = json.loads(path.read_text())
        check_lock(cfg, lock)
        log.info("scene lock reused: %s", path)
        return lock
    lock = select_scenes(cfg, bbox)
    path.write_text(json.dumps(lock, indent=2, sort_keys=True) + "\n")
    log.info("scene lock written: %d looks of %d candidate items", len(lock["looks"]), lock["candidates"])
    return lock


# ---------------------------------------------------------------- reads

def read_window(href: str, grid: Grid, resampling: Resampling, dtype: str, nodata) -> np.ndarray:
    """One raster warped onto the grid; cells outside the source or at its nodata -> nodata."""
    with rasterio.open(href) as src, WarpedVRT(
            src, crs=grid.crs, transform=grid.transform, width=grid.width, height=grid.height,
            resampling=resampling, src_nodata=src.nodata,
            nodata=np.nan if nodata == "nan" else nodata, dtype=dtype) as vrt:
        return vrt.read(1)


def read_look(lock_look: dict, grid: Grid) -> dict[str, np.ndarray]:
    """DN stack of one look, items mosaicked (first non-nodata in item-id order)."""
    out = {n: np.zeros((grid.height, grid.width), np.uint8 if n == "scl" else np.uint16)
           for n in ASSETS}
    for item in sorted(lock_look["items"], key=lambda i: i["id"]):
        have = out["scl"] != 0
        for n in ASSETS:
            res = Resampling.nearest if n == "scl" else Resampling.bilinear
            arr = read_window(item["assets"][n]["href"], grid, res,
                              "uint8" if n == "scl" else "uint16", 0)
            take = (out[n] == 0) & (arr != 0) if n != "scl" else ~have & (arr != 0)
            out[n][take] = arr[take]
    return out


def tile_name(lat: int, lon: int) -> tuple[str, str]:
    return (f"{'N' if lat >= 0 else 'S'}{abs(lat):02d}", f"{'E' if lon >= 0 else 'W'}{abs(lon):03d}")


def read_dem(cfg: Config, grid: Grid, warnings: list[str]) -> np.ndarray:
    w, s, e, n = grid_lonlat_bbox(grid)
    dem = np.full((grid.height, grid.width), np.nan, np.float32)
    for lat in range(math.floor(s), math.floor(n) + 1):
        for lon in range(math.floor(w), math.floor(e) + 1):
            la, lo = tile_name(lat, lon)
            url = cfg.dem_url_template.format(lat=la, lon=lo)
            try:
                arr = read_window(url, grid, Resampling.bilinear, "float32", "nan")
            except RasterioIOError as err:  # missing tile (404) or network error
                msg = f"DEM tile {la}{lo} unavailable: {str(err).splitlines()[0]}"
                log.warning(msg)
                warnings.append(msg)
                continue
            fill = np.isnan(dem) & ~np.isnan(arr)
            dem[fill] = arr[fill]
    return dem


# ---------------------------------------------------------------- entry

def _npz_save(path: Path, **arrays) -> None:
    tmp = path.with_suffix(".tmp.npz")
    np.savez_compressed(tmp, **arrays)
    tmp.replace(path)


def acquire(cfg: Config, region: str, section_id: str, reselect: bool = False) -> Stack:
    lonlat, bbox = load_course(region, section_id)
    grid, course_xy, aoi = build_grid(cfg, lonlat)
    cache = work_dir(region) / "cache" / section_id
    cache.mkdir(parents=True, exist_ok=True)
    warnings: list[str] = []
    aoi_mask = rasterize([(mapping(aoi), 1)], out_shape=(grid.height, grid.width),
                         transform=grid.transform, fill=0, dtype="uint8").astype(bool)
    lock = get_lock(cfg, cache, grid_lonlat_bbox(grid), reselect)
    if len(lock["looks"]) < cfg.stac.looks:
        warnings.append(f"only {len(lock['looks'])} looks pinned, {cfg.stac.looks} wanted")

    looks, fractions = [], []
    with rasterio.Env(**GDAL_ENV):
        for lk in lock["looks"]:
            npz = cache / f"look-{lk['date']}.npz"
            if npz.is_file():
                with np.load(npz) as z:
                    dn = {n: z[n] for n in ASSETS}
                if dn["scl"].shape != (grid.height, grid.width):
                    raise RuntimeError(f"{npz}: grid shape changed, delete the cache")
            else:
                log.info("reading look %s (%d items)", lk["date"], len(lk["items"]))
                dn = read_look(lk, grid)
                _npz_save(npz, **dn)
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

        dem_npz = cache / "dem.npz"
        if dem_npz.is_file():
            with np.load(dem_npz) as z:
                dem = z["dem"]
        else:
            log.info("reading DEM tiles")
            dem = read_dem(cfg, grid, warnings)
            _npz_save(dem_npz, dem=dem)
    cov = round(float((~np.isnan(dem))[aoi_mask].mean()), 4)
    if cov < 1:
        warnings.append(f"DEM covers {cov} of the AOI")
    return Stack(section_id, grid, course_xy, looks, dem, aoi_mask, fractions, cov, warnings)
