"""
pipeline:flow-water — water network of the flow sections from Sentinel-2 and GLO-30 (F2).
Needs regions/<id>/flow-water.config.json and public/flow/<id>/ (pipeline:flow-sections).

    flowwater --region <id> [--only id1,id2] [--reselect]

--region is required (no default region). Without --only every section of
public/flow/<id>/index.json is processed. Writes data/work/<id>/flow-water/out/<section>.net.json and
.qa.geojson, report.json (sorted keys, nothing time-dependent) and flow-water.log there.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys

from flowwater.acquire import acquire
from flowwater.config import load_config
from flowwater.contract import write_section
from flowwater.network import build_network
from flowwater.paths import flow_dir, work_dir
from flowwater.water import run_water

log = logging.getLogger("flowwater")


def section_ids(region: str, only: list[str] | None) -> list[str]:
    index = flow_dir(region) / "index.json"
    if not index.is_file():
        print(f"{index} not found: run pipeline:flow-sections for {region} first", file=sys.stderr)
        raise SystemExit(2)
    ids = [s["id"] for r in json.loads(index.read_text())["rivers"] for s in r["sections"]]
    if only is None:
        return ids
    unknown = [i for i in only if i not in ids]
    if unknown:
        print(f"unknown section ids: {', '.join(unknown)}", file=sys.stderr)
        raise SystemExit(2)
    return sorted(set(only))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="flowwater", description=__doc__.strip().splitlines()[0])
    ap.add_argument("--region", required=True)
    ap.add_argument("--only", help="comma-separated section ids")
    ap.add_argument("--reselect", action="store_true", help="redo the STAC search and rewrite the scene locks")
    args = ap.parse_args(argv)

    cfg = load_config(args.region)
    only = [s for s in args.only.split(",") if s] if args.only else None
    ids = section_ids(args.region, only)

    wd = work_dir(args.region)
    wd.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s",
                        handlers=[logging.StreamHandler(sys.stdout),
                                  logging.FileHandler(wd / "flow-water.log", mode="w")])
    logging.getLogger("rasterio").setLevel(logging.WARNING)  # per-open boto3 notices
    log.info("region %s: %d sections", args.region, len(ids))

    sections, ok = {}, True
    for sid in ids:
        try:
            st = acquire(cfg, args.region, sid, args.reselect)
            wr = run_water(cfg, args.region, st) if st.looks else None
            net = build_network(cfg, st, wr) if wr is not None else None
            out = write_section(cfg, args.region, st, wr, net) if net is not None else None
        except Exception as e:  # keep going: the report lists the failed section
            log.exception("section %s failed", sid)
            sections[sid] = {"error": f"{type(e).__name__}: {e}"}
            ok = False
            continue
        sections[sid] = {
            "looks": [{"date": lk.date, "itemIds": lk.item_ids, "validFraction": f}
                      for lk, f in zip(st.looks, st.look_valid_fraction)],
            "demCoverage": st.dem_coverage,
            "grid": {"crs": st.grid.crs, "height": st.grid.height, "width": st.grid.width},
            "warnings": st.warnings,
        }
        if wr is not None:
            sections[sid]["water"] = wr.stats
            sections[sid]["network"] = net.stats
            sections[sid]["out"] = out
        if not st.looks:
            ok = False
        log.info("%s: %d looks, grid %dx%d, DEM %.3f", sid, len(st.looks), st.grid.height,
                 st.grid.width, st.dem_coverage)
        if wr is not None:
            log.info("%s: water %.3f km2, reservoir %.3f km2, %d reservoirs, lakeIoU %s", sid,
                     wr.stats["waterKm2"], wr.stats["reservoirKm2"], len(wr.reservoirs),
                     wr.stats["lakeIoU"])
            log.info("%s: network %s", sid, net.stats)
    report = {
        "ok": ok,
        "region": args.region,
        "sections": sections,
        "totals": {
            "sections": len(ids),
            "failed": sum("error" in s for s in sections.values()),
            "looks": sum(len(s.get("looks", [])) for s in sections.values()),
            "warnings": sum(len(s.get("warnings", [])) for s in sections.values()),
            "netBytesTotal": sum(s.get("out", {}).get("netBytes", 0) for s in sections.values()),
        },
    }
    (wd / "report.json").write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    log.info("report: ok=%s", ok)
    return 0 if ok else 1
