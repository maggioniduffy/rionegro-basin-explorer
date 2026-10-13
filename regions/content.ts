import { cbaContent } from "./cba/content";
import { nqnContent } from "./nqn/content";
import type { RegionId } from "./index";

/**
 * What a region shows besides its UI strings (regions/<id>/messages): links, the landing
 * sample's picks, the OG subtitle and the ask box's prompt. Generated files are in
 * regions/generated.ts, the landing image in regions/images.ts (kept apart so scripts
 * run by tsx never import a .png).
 */
export interface RegionContent {
  /** The landing card's quick links: river slugs (rivers.ndjson `_id`) and their names. */
  featuredRivers: readonly { id: string; name: string }[];
  /** The river and sub-basin the landing's sample cards show (scripts/landing-sample.ts). */
  landingSample: { river: string; subbasin: string };
  /** The landing's "built on" row: data sources, proper nouns, so not translated. */
  landingSources: readonly string[];
  /** The OG image's line under the titles. Proper nouns only, so not translated. */
  ogSubtitle: string;
  llm: {
    /** "an interactive map of <place>" in the system prompt. */
    place: string;
    /** Phrases a `within` filter maps from, naming this region's sub-basins. */
    withinExample: string;
    /** One "question" -> {intent JSON} per line; every slug must exist in the region's data. */
    examples: string;
  };
}

export const REGION_CONTENT: Record<RegionId, RegionContent> = {
  nqn: nqnContent,
  cba: cbaContent,
};
