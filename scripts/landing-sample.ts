/**
 * landing-sample — the real values behind the landing's mock panels (components/landing),
 * read from the seed files, so the landing shows no invented numbers (CLAUDE.md rule 2).
 * Rerun after `pipeline:export` or `pipeline:subbasins` changes data/out/nqn (the sample
 * picks Río Negro rivers; per-region samples come with the region content, PLAN.md R1):
 *
 *   npm run landing:sample
 *
 * Writes app/landing-sample.json; tests/landing-sample.test.ts fails while it is stale.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const OUT = "app/landing-sample.json";
/** The river in the "Rivers & tributaries" card and the hero card's chip. */
const RIVER = "limay";
/** The sub-basin in the "Sub-basins" card. */
const SUBBASIN = "neuquen";

interface RiverDoc {
  _id: string;
  name: string;
  flowsInto: string;
  lengthKm: number;
  mouth: { strahler: number; dischargeM3s: number | null };
}
interface SubbasinDoc {
  _id: string;
  name: string | null;
  parentId: string | null;
}

export interface LandingSample {
  river: {
    id: string;
    name: string;
    /** rivers.ndjson `lengthKm`. */
    lengthKm: number;
    /** rivers.ndjson `mouth.strahler` (HydroRIVERS ORD_STRA at the mouth). */
    strahler: number;
    /** rivers.ndjson `mouth.dischargeM3s` (RiverATLAS dis_m3_pyr, modeled 1971–2000). */
    dischargeM3s: number | null;
    flowsInto: { id: string; name: string };
  };
  subbasin: {
    id: string;
    name: string;
    parent: { id: string; name: string };
    /** Names of its child sub-basins, in seed order. */
    children: string[];
  };
}

function ndjson<T>(file: string): T[] {
  return readFileSync(join(process.cwd(), "data/out/nqn", file), "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as T);
}

function find<T extends { _id: string }>(docs: T[], id: string): T {
  const doc = docs.find((d) => d._id === id);
  if (!doc) throw new Error(`${id} is not in data/out`);
  return doc;
}

export function buildLandingSample(): LandingSample {
  const rivers = ndjson<RiverDoc>("rivers.ndjson");
  const subbasins = ndjson<SubbasinDoc>("subbasins.ndjson");
  const river = find(rivers, RIVER);
  const mouth = find(rivers, river.flowsInto);
  const sub = find(subbasins, SUBBASIN);
  if (sub.name === null || sub.parentId === null)
    throw new Error(`${SUBBASIN} needs a name and a parent`);
  const parent = find(subbasins, sub.parentId);
  if (parent.name === null) throw new Error(`${parent._id} has no name`);
  return {
    river: {
      id: river._id,
      name: river.name,
      lengthKm: river.lengthKm,
      strahler: river.mouth.strahler,
      dischargeM3s: river.mouth.dischargeM3s,
      flowsInto: { id: mouth._id, name: mouth.name },
    },
    subbasin: {
      id: sub._id,
      name: sub.name,
      parent: { id: parent._id, name: parent.name },
      children: subbasins
        .filter((s) => s.parentId === sub._id)
        .map((s) => s.name)
        .filter((n): n is string => n !== null),
    },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  writeFileSync(OUT, `${JSON.stringify(buildLandingSample(), null, 2)}\n`);
  console.log(`wrote ${OUT}`);
}
