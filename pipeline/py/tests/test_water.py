import json
from pathlib import Path

import numpy as np

from flowwater.acquire import BANDS, Look
from flowwater.config import parse_config
from flowwater.water import look_indices

CONFIG = Path(__file__).resolve().parents[3] / "regions" / "nqn" / "flow-water.config.json"


def _old_inline(cfg, lk, scl_valid):
    """The per-look math water_frequency had before look_indices was extracted."""
    w = cfg.water
    b = lk.bands

    def ratio(a, c):
        d = a + c
        with np.errstate(invalid="ignore", divide="ignore"):
            out = (a - c) / d
        return np.where(d > np.float32(1e-6), out, np.float32(np.nan)).astype(np.float32)

    mndwi, ndvi = ratio(b["green"], b["swir16"]), ratio(b["nir"], b["red"])
    finite = np.isfinite(mndwi) & np.isfinite(ndvi)
    for n in BANDS:
        finite &= np.isfinite(b[n])
    valid = np.isin(lk.scl, scl_valid) & finite
    with np.errstate(invalid="ignore"):
        wet = valid & (mndwi > w.mndwi_min) & (ndvi < w.ndvi_max)
    return mndwi, ndvi, valid, wet


def test_look_indices_matches_inline_formulas():
    cfg = parse_config(json.loads(CONFIG.read_text()), CONFIG)
    rng = np.random.default_rng(0)
    bands = {n: rng.uniform(0.01, 0.4, (4, 5)).astype(np.float32) for n in BANDS}
    bands["green"][0, 0] = np.nan
    for n in BANDS:
        bands[n][1, 1] = 0.0  # zero-sum pixel
    bands["green"][2, 2], bands["swir16"][2, 2] = 0.3, 0.02  # water-like
    bands["nir"][2, 2], bands["red"][2, 2] = 0.02, 0.05
    scl = np.array([[4, 4, 4, 4, 4], [4, 4, 8, 9, 4], [5, 2, 3, 0, 11], [6, 7, 10, 1, 4]], np.uint8)
    look = Look("2024-01-01", ["x"], bands, scl)
    for sv in (cfg.water.scl_valid, (4, 5, 6)):
        got = look_indices(cfg, look, None if sv == cfg.water.scl_valid else sv)
        want = _old_inline(cfg, look, sv)
        for g, e in zip(got, want):
            assert g.dtype == e.dtype
            np.testing.assert_array_equal(g, e)
    assert got[2].any() and not got[2].all()
