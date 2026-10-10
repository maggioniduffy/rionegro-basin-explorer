/**
 * landing-sample — the real values behind the landing's mock panels (components/landing),
 * read from the seed files, so the landing shows no invented numbers (CLAUDE.md rule 2).
 * Rerun after `pipeline:export` or `pipeline:subbasins` changes data/out/<region>:
 *
 *   npm run landing:sample -- --region <id>    # --region is required
 *
 * The river and sub-basin come from regions/<id>/content.ts (`landingSample`, default export). Writes
 * regions/<id>/landing-sample.json; tests/landing-sample.test.ts fails while it is stale.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseRegionArg } from "../pipeline/lib/paths";
import type { KnownRegionId } from "../regions";
import type { RegionContent } from "../regions/content";

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

function ndjson<T>(region: KnownRegionId, file: string): T[] {
  return readFileSync(join(process.cwd(), "data/out", region, file), "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as T);
}

function find<T extends { _id: string }>(docs: T[], id: string): T {
  const doc = docs.find((d) => d._id === id);
  if (!doc) throw new Error(`${id} is not in data/out`);
  return doc;
}

export function buildLandingSample(
  region: KnownRegionId,
  picks: RegionContent["landingSample"],
): LandingSample {
  const { river: RIVER, subbasin: SUBBASIN } = picks;
  const rivers = ndjson<RiverDoc>(region, "rivers.ndjson");
  const subbasins = ndjson<SubbasinDoc>(region, "subbasins.ndjson");
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

async function main() {
  const region = parseRegionArg(process.argv);
  // Read the region's own content file, not the registry: a region isn't served (and isn't
  // in the registry) until this file exists.
  const content = (
    (await import(`../regions/${region}/content.ts`)) as {
      default: RegionContent;
    }
  ).default;
  const OUT = `regions/${region}/landing-sample.json`;
  writeFileSync(
    OUT,
    `${JSON.stringify(buildLandingSample(region, content.landingSample), null, 2)}\n`,
  );
  console.log(`wrote ${OUT}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
