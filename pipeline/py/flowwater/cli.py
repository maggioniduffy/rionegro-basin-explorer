"""
pipeline:flow-water — water network of the flow sections from Sentinel-2 and GLO-30 (F2, batches F3).
Needs regions/<id>/flow-water.config.json and public/flow/<id>/ (pipeline:flow-sections).

    flowwater --region <id> [--only id1,limay-076..limay-102] [--rivers limay,negro] [--force] [--reselect] [--report-only]

--region is required (no default region). Without --only and --rivers every section of
public/flow/<id>/index.json is processed; the two combine as a union. A section whose outputs are up
to date (inputsHash of the config, scene lock, section file, lakes file and FLOWWATER_VERSION) is skipped unless
--force or --reselect. Writes, atomically, data/work/<id>/flow-water/out/<section>.net.json, .qa.geojson
and .report.json (deterministic, no timings), then rebuilds report.json from every out/*.report.json
(run timings only under lastRun) and flow-water.log there.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import re
import sys
import time

from flowwater.acquire import acquire
from flowwater.config import load_config
from flowwater.contract import _write, out_dir, write_section
from flowwater.network import build_network
from flowwater.paths import config_path, flow_dir, work_dir
from flowwater.water import run_water

log = logging.getLogger("flowwater")

# Bump whenever the output logic changes (water, network, contract): it invalidates every inputsHash.
FLOWWATER_VERSION = "f3.1.1"

RANGE = re.compile(r"^(.+)\.\.(.+)$")


def _die(msg: str) -> "None":
    print(msg, file=sys.stderr)
    raise SystemExit(2)


def load_index(region: str) -> tuple[list[str], dict[str, tuple[str, int]]]:
    """(section ids in index order, id -> (river slug, section index))."""
    index = flow_dir(region) / "index.json"
    if not index.is_file():
        _die(f"{index} not found: run pipeline:flow-sections for {region} first")
    where = {}
    for r in json.loads(index.read_text())["rivers"]:
        for s in r["sections"]:
            where[s["id"]] = (r["slug"], s["index"])
    return list(where), where


def select_ids(ids: list[str], where: dict[str, tuple[str, int]], only: str | None,
               rivers: str | None) -> list[str]:
    """Union of --only (ids and ranges) and --rivers, in index order; everything when neither is given."""
    if not only and not rivers:
        return ids
    chosen: set[str] = set()
    unknown = []
    for item in (x.strip() for x in (only or "").split(",") if x.strip()):
        m = RANGE.match(item)
        if not m:
            if item in where:
                chosen.add(item)
            else:
                unknown.append(item)
            continue
        a, b = m.groups()
        bad = [x for x in (a, b) if x not in where]
        if bad:
            _die(f"unknown section ids in range {item}: {', '.join(bad)}")
        (ra, ia), (rb, ib) = where[a], where[b]
        if ra != rb:
            _die(f"range {item} mixes rivers ({ra}, {rb}): a range stays within one river")
        if ia > ib:
            _die(f"range {item} is reversed: {a} comes after {b}")
        chosen.update(i for i, (r, k) in where.items() if r == ra and ia <= k <= ib)
    if unknown:
        _die(f"unknown section ids: {', '.join(unknown)}")
    if rivers:
        slugs = [x.strip() for x in rivers.split(",") if x.strip()]
        bad = [x for x in slugs if x not in {r for r, _ in where.values()}]
        if bad:
            _die(f"unknown river slugs: {', '.join(bad)}")
        chosen.update(i for i, (r, _) in where.items() if r in slugs)
    return [i for i in ids if i in chosen]


def inputs_hash(region: str, sid: str) -> str | None:
    """sha256 over the config (canonical JSON), the scene lock, the section file, the HydroLAKES file
    (sha256, empty when absent) and the version;
    None when the scene lock does not exist yet (nothing to compare)."""
    lock = work_dir(region) / "cache" / sid / "scenes.lock.json"
    if not lock.is_file():
        return None
    cfg = json.dumps(json.loads(config_path(region).read_text()), sort_keys=True, separators=(",", ":"))
    h = hashlib.sha256()
    lakes = work_dir(region).parent / "lakes" / "lakes.geojson"  # lakeIoU reads it
    for part in (FLOWWATER_VERSION.encode(), cfg.encode(), lock.read_bytes(),
                 (flow_dir(region) / f"{sid}.json").read_bytes(),
                 hashlib.sha256(lakes.read_bytes()).digest() if lakes.is_file() else b""):
        h.update(len(part).to_bytes(8, "big"))
        h.update(part)
    return h.hexdigest()


def section_report_path(region: str, sid: str):
    return out_dir(region) / f"{sid}.report.json"


def up_to_date(region: str, sid: str) -> bool:
    out, rp = out_dir(region), section_report_path(region, sid)
    if not all(p.is_file() for p in (out / f"{sid}.net.json", out / f"{sid}.qa.geojson", out / f"{sid}.water.tif", rp)):
        return False
    h = inputs_hash(region, sid)
    try:
        return h is not None and json.loads(rp.read_text()).get("inputsHash") == h
    except ValueError:
        return False


def _dump(obj) -> bytes:
    return (json.dumps(obj, indent=2, sort_keys=True) + "\n").encode()


def rebuild_report(region: str, last_run: dict) -> bool:
    """report.json from every out/*.report.json (sorted by id), so batches accumulate."""
    sections = {}
    for p in sorted(out_dir(region).glob("*.report.json")):
        sections[p.name[: -len(".report.json")]] = json.loads(p.read_text())
    ok = all("error" not in s and s.get("looks") for s in sections.values())
    report = {
        "ok": ok,
        "region": region,
        "sections": sections,
        "totals": {
            "sections": len(sections),
            "failed": sum("error" in s for s in sections.values()),
            "looks": sum(len(s.get("looks", [])) for s in sections.values()),
            "warnings": sum(len(s.get("warnings", [])) for s in sections.values()),
            "netBytesTotal": sum(s.get("out", {}).get("netBytes", 0) for s in sections.values()),
        },
        "lastRun": last_run,
    }
    _write(work_dir(region) / "report.json", _dump(report))
    return ok


def process(cfg, region: str, sid: str, reselect: bool) -> dict:
    """Run one section; returns its (deterministic) report. Raises on failure."""
    st = acquire(cfg, region, sid, reselect)
    h = inputs_hash(region, sid)  # after acquire: the lock exists now
    wr = run_water(cfg, region, st) if st.looks else None
    net = build_network(cfg, st, wr) if wr is not None else None
    out = write_section(cfg, region, st, wr, net) if net is not None else None
    rep = {
        "looks": [{"date": lk.date, "itemIds": lk.item_ids, "validFraction": f}
                  for lk, f in zip(st.looks, st.look_valid_fraction)],
        "demCoverage": st.dem_coverage,
        "grid": {"crs": st.grid.crs, "height": st.grid.height, "width": st.grid.width},
        "warnings": st.warnings,
    }
    log.info("%s: %d looks, grid %dx%d, DEM %.3f", sid, len(st.looks), st.grid.height,
             st.grid.width, st.dem_coverage)
    if wr is not None:
        rep["water"] = wr.stats
        rep["network"] = net.stats
        rep["out"] = out
        rep["inputsHash"] = h
        log.info("%s: water %.3f km2, reservoir %.3f km2, %d reservoirs, lakeIoU %s", sid,
                 wr.stats["waterKm2"], wr.stats["reservoirKm2"], len(wr.reservoirs), wr.stats["lakeIoU"])
        log.info("%s: network %s", sid, net.stats)
    return rep


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="flowwater", description=__doc__.strip().splitlines()[0])
    ap.add_argument("--region", required=True)
    ap.add_argument("--only", help="comma-separated section ids and ranges (limay-076..limay-102)")
    ap.add_argument("--rivers", help="comma-separated river slugs (all their sections)")
    ap.add_argument("--force", action="store_true", help="reprocess sections whose outputs are up to date")
    ap.add_argument("--reselect", action="store_true", help="redo the STAC search and rewrite the scene locks")
    ap.add_argument("--report-only", action="store_true",
                    help="only rebuild report.json from the out/*.report.json present (no processing, no downloads)")
    args = ap.parse_args(argv)

    cfg = load_config(args.region)
    all_ids, where = load_index(args.region)
    ids = select_ids(all_ids, where, args.only, args.rivers)

    wd = work_dir(args.region)
    wd.mkdir(parents=True, exist_ok=True)
    out_dir(args.region).mkdir(parents=True, exist_ok=True)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s",
                        handlers=[logging.StreamHandler(sys.stdout),
                                  logging.FileHandler(wd / "flow-water.log", mode="w")])
    logging.getLogger("rasterio").setLevel(logging.WARNING)  # per-open boto3 notices
    if args.report_only:
        ok = rebuild_report(args.region, {"sectionsInRun": [], "skipped": [], "processed": [], "failed": [],
                                          "interrupted": False, "force": False, "reportOnly": True})
        log.info("report only: ok=%s", ok)
        return 0  # failed sections are filtered by flow-net-publish, not by this exit code
    log.info("region %s: %d sections in this run", args.region, len(ids))

    skipped, processed, failed = [], [], []
    interrupted = False
    try:
        for sid in ids:
            if not (args.force or args.reselect) and up_to_date(args.region, sid):
                log.info("%s: up to date", sid)
                skipped.append(sid)
                continue
            rp = section_report_path(args.region, sid)
            rp.unlink(missing_ok=True)  # an interrupted run must not leave a valid report beside new outputs
            t0 = time.monotonic()
            try:
                rep = process(cfg, args.region, sid, args.reselect)
            except Exception as e:  # keep going: the report lists the failed section
                log.exception("section %s failed", sid)
                rep = {"error": f"{type(e).__name__}: {e}"}
                failed.append(sid)
            else:
                processed.append({"id": sid, "elapsedS": round(time.monotonic() - t0, 1)})
            _write(rp, _dump(rep))
    except KeyboardInterrupt:
        interrupted = True
        log.warning("interrupted: sections written so far stay valid")
    ok = rebuild_report(args.region, {
        "sectionsInRun": ids, "skipped": skipped, "processed": processed, "failed": failed,
        "interrupted": interrupted, "force": bool(args.force or args.reselect),
    })
    log.info("report: ok=%s (%d processed, %d skipped, %d failed)", ok, len(processed), len(skipped),
             len(failed))
    if interrupted:
        return 130
    return 0 if ok and not failed else 1
