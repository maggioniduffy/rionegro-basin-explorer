/**
 * Which pipeline step produces the line names (cover.parquet / reach_ign.parquet) that
 * pipeline:named, pipeline:ign-streams and pipeline:export read, and the provenance text that
 * says where the names come from. Chosen by an explicit `namesFrom` key in
 * regions/<id>/ign.config.json, never by guessing from which files exist:
 *
 *   absent or "ign-match"  pipeline:ign-match (IGN lines only; nqn)
 *   "line-names"           pipeline:line-names (APRHI inside the province, IGN outside; cba)
 *
 * No default region and no fallback: an unknown value throws.
 */
import { readFile } from "node:fs/promises";
import { regionFile, REGION_ID, workPath } from "./paths";

export type NamesFrom = "ign-match" | "line-names";

export interface NameSource {
  id: NamesFrom;
  /** Subdirectory of data/work/<region>/ holding cover.parquet and reach_ign.parquet. */
  step: NamesFrom;
  /** Text for the `name` provenance of the river documents (pipeline:named). */
  riverNameProvenance: string;
  /** Text for the `name` provenance of the stream documents (pipeline:export). */
  streamNameProvenance: string;
}

const IGN = "FUENTE: Instituto Geográfico Nacional de la República Argentina";
const APRHI = "FUENTE: Portal de Información Hídrica de Córdoba";

/** The name source for a `namesFrom` setting (undefined = "ign-match"). */
export function resolveNameSource(
  namesFrom: unknown,
  region: string = "?",
): NameSource {
  if (namesFrom === undefined || namesFrom === "ign-match") {
    return {
      id: "ign-match",
      step: "ign-match",
      // Provenance text seeded to Mongo: the old config path stays until the next re-export (Phase R1).
      riverNameProvenance: `pipeline/names.json (hand-approved; IGN spelling, ${IGN})`,
      streamNameProvenance:
        "pipeline:ign-streams: most frequent IGN spelling of the stream's name (pipeline:ign-match)",
    };
  }
  if (namesFrom === "line-names") {
    return {
      id: "line-names",
      step: "line-names",
      riverNameProvenance: `regions/${region}/names.json (hand-approved; names from APRHI (${APRHI}) inside the province and from IGN (${IGN}) outside, pipeline:line-names)`,
      streamNameProvenance:
        `pipeline:ign-streams: most frequent spelling of the stream's name (pipeline:line-names: APRHI (${APRHI}) inside the province, ` +
        `IGN (${IGN}) outside)`,
    };
  }
  throw new Error(
    `regions/${region}/ign.config.json: namesFrom must be "ign-match" or "line-names" (got ${JSON.stringify(namesFrom)})`,
  );
}

/** The current region's name source, from its ign.config.json. */
export async function loadNameSource(): Promise<NameSource> {
  const cfg = JSON.parse(
    await readFile(regionFile("ign.config.json"), "utf8"),
  ) as { namesFrom?: unknown };
  return resolveNameSource(cfg.namesFrom, REGION_ID);
}

/** Path of a name file (cover.parquet, reach_ign.parquet) of the current region. */
export const nameFile = (source: NameSource, file: string) =>
  workPath(source.step, file);
