import { z } from "zod";
import type { RegionId } from "@/regions";
import cbaConfig from "@/regions/cba/effluent.config.json";
import cbaNet from "@/regions/cba/effluent-net.json";
import {
  parseEffluentConfig,
  parseEffluentNet,
  parseNetPieces,
  type EffluentConfig,
  type EffluentNet,
} from "./schema";

/** The GloFAS cell of each gauge; the config schema does not keep it, so it is read here. */
const cellsSchema = z.object({
  gauges: z.array(
    z.object({
      id: z.string().min(1),
      cell: z.object({ lat: z.number().finite(), lon: z.number().finite() }),
    }),
  ),
});

export interface EffluentRegion {
  config: EffluentConfig;
  net: EffluentNet;
  /** Net reach id -> line pieces of the tiles the plume paints on it. */
  netPieces: Map<number, string[]>;
  gaugeCells: { id: string; lat: number; lon: number }[];
}

function build(rawConfig: unknown, rawNet: unknown): EffluentRegion {
  return {
    config: parseEffluentConfig(rawConfig),
    net: parseEffluentNet(rawNet),
    netPieces: parseNetPieces(rawNet),
    gaugeCells: cellsSchema
      .parse(rawConfig)
      .gauges.map((g) => ({ id: g.id, ...g.cell })),
  };
}

/** Regions with an effluent config and net; static imports, so no file reads at request time. */
const REGIONS: Partial<Record<RegionId, EffluentRegion>> = {
  cba: build(cbaConfig, cbaNet),
};

export function getEffluentRegion(id: RegionId): EffluentRegion | null {
  return REGIONS[id] ?? null;
}
