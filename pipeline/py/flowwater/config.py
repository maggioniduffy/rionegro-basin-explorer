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
class Config:
    crs: str
    resolution_m: float
    corridor_m: float
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
        cfg = Config(
            crs=str(raw["crs"]),
            resolution_m=float(raw["resolutionM"]),
            corridor_m=float(raw["corridorM"]),
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
    for k in ("{lat}", "{lon}"):
        if k not in cfg.dem_url_template:
            _fail(f"{path}: dem.urlTemplate must contain {k}")
    return cfg
