"""Repo paths: ROOT is the nearest parent holding package.json."""

from pathlib import Path


def _find_root() -> Path:
    for p in Path(__file__).resolve().parents:
        if (p / "package.json").is_file():
            return p
    raise RuntimeError("repo root (package.json) not found above " + __file__)


ROOT = _find_root()


def work_dir(region: str) -> Path:
    return ROOT / "data" / "work" / region / "flow-water"


def flow_dir(region: str) -> Path:
    """public/flow/<region>: the F1 sections (read only)."""
    return ROOT / "public" / "flow" / region


def config_path(region: str) -> Path:
    return ROOT / "regions" / region / "flow-water.config.json"
