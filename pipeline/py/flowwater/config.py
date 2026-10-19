"""Load and validate regions/<region>/flow-water.config.json."""

import json
import sys
from dataclasses import dataclass

from flowwater.paths import config_path


@dataclass(frozen=True)
class StacConfig:
    url: str
    collection: str
    datetime: str
    max_cloud_pct: float
    looks: int


@dataclass(frozen=True)
class WaterConfig:
    scl_valid: tuple[int, ...]
    mndwi_min: float
    ndvi_max: float
    min_freq: float
    min_valid_looks: int
    closing_px: int
    min_island_m2: float
    keep_corridor_m: float


@dataclass(frozen=True)
class ReservoirConfig:
    min_half_width_m: float
    min_area_km2: float
    simplify_m: float


@dataclass(frozen=True)
class Config:
    crs: str
    resolution_m: float
    corridor_m: float
    water: WaterConfig
    reservoir: ReservoirConfig
    stac: StacConfig
    dem_url_template: str


def _fail(msg: str) -> "None":
    print(msg, file=sys.stderr)
    raise SystemExit(2)


def load_config(region: str) -> Config:
    path = config_path(region)
    if not path.is_file():
        _fail(f"region {region} has no flow-water.config.json")
    raw = json.loads(path.read_text())
    try:
        s = raw["stac"]
        w, rv = raw["water"], raw["reservoir"]
        cfg = Config(
            crs=str(raw["crs"]),
            resolution_m=float(raw["resolutionM"]),
            corridor_m=float(raw["corridorM"]),
            water=WaterConfig(
                scl_valid=tuple(int(c) for c in w["sclValid"]),
                mndwi_min=float(w["mndwiMin"]),
                ndvi_max=float(w["ndviMax"]),
                min_freq=float(w["minFreq"]),
                min_valid_looks=int(w["minValidLooks"]),
                closing_px=int(w["closingPx"]),
                min_island_m2=float(w["minIslandM2"]),
                keep_corridor_m=float(w["keepCorridorM"]),
            ),
            reservoir=ReservoirConfig(
                min_half_width_m=float(rv["minHalfWidthM"]),
                min_area_km2=float(rv["minAreaKm2"]),
                simplify_m=float(rv["simplifyM"]),
            ),
            stac=StacConfig(
                url=str(s["url"]),
                collection=str(s["collection"]),
                datetime=str(s["datetime"]),
                max_cloud_pct=float(s["maxCloudPct"]),
                looks=int(s["looks"]),
            ),
            dem_url_template=str(raw["dem"]["urlTemplate"]),
        )
    except KeyError as e:
        _fail(f"{path}: missing key {e}")
    if cfg.resolution_m <= 0 or cfg.corridor_m <= 0 or cfg.stac.looks < 1:
        _fail(f"{path}: resolutionM, corridorM and stac.looks must be positive")
    w, rv = cfg.water, cfg.reservoir
    if not w.scl_valid or any(not 0 <= c <= 11 for c in w.scl_valid):
        _fail(f"{path}: water.sclValid must list SCL classes 0..11")
    if not (-1 <= w.mndwi_min <= 1 and -1 <= w.ndvi_max <= 1 and 0 < w.min_freq <= 1):
        _fail(f"{path}: water.mndwiMin/ndviMax must be in [-1, 1] and minFreq in (0, 1]")
    if not 1 <= w.min_valid_looks <= cfg.stac.looks:
        _fail(f"{path}: water.minValidLooks must be between 1 and stac.looks")
    if w.closing_px < 1 or w.min_island_m2 < 0 or w.keep_corridor_m <= 0:
        _fail(f"{path}: water.closingPx >= 1, minIslandM2 >= 0 and keepCorridorM > 0 required")
    if rv.min_half_width_m <= 0 or rv.min_area_km2 < 0 or rv.simplify_m < 0:
        _fail(f"{path}: reservoir.minHalfWidthM > 0, minAreaKm2 >= 0 and simplifyM >= 0 required")
    for k in ("{lat}", "{lon}"):
        if k not in cfg.dem_url_template:
            _fail(f"{path}: dem.urlTemplate must contain {k}")
    return cfg
