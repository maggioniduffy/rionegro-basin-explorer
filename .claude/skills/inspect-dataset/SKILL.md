---
name: inspect-dataset
description: Profile a geodata or tabular file (Parquet, GeoJSON, NDJSON, CSV, Shapefile, FileGDB layer) without dumping rows — schema, row count, per-column nulls/min/max/distinct, geometry types, extent, invalid count. Use before relying on any attribute name, and whenever you need to know what a data/raw, data/work or data/out file contains.
argument-hint: "<path> [--layer=<name>]"
allowed-tools: Bash(npm run -s inspect:file *), Bash(npm run inspect:file *), Bash(jq *), Read
---

# Inspect a dataset

CLAUDE.md rules 2 and 6: never guess attribute names, never `cat` geo files.

## Procedure

1. **Raw sources first.** For anything under `data/raw/`, check the existing
   profiles from `npm run pipeline:inspect` before scanning again:
   `data/work/inspect/<source>__<layer>.json` (index in `data/work/inspect/report.json`).
2. **Any other file:** `npm run -s inspect:file -- <path> [--layer=<name>] [--samples=<n>]`.
   It prints a 3-line summary and writes the full profile to
   `data/work/inspect/adhoc/<file>[__<layer>].json`. FileGDB needs `--layer`.
3. **Drill down with jq, not by reading the whole profile**, e.g.
   - `jq '.columns' <profile>`
   - `jq '.stats[] | select(.column=="ORD_STRA")' <profile>`
   - `jq '.geometry' <profile>`
4. For questions the profile can't answer (a group-by, a join count), write the
   query into a pipeline step or a throwaway script under the session scratchpad,
   and return only aggregates.

## Report back

- File, row count, geometry type(s), extent, invalid geometries.
- Only the columns relevant to the question, with their exact names and types, as
  written in the profile.
- Null % and ranges for those columns; flag anything surprising (all-null, constant,
  sentinel values like -999, unexpected CRS).
- Never paste sample rows or coordinates beyond what the question needs.
