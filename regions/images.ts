import type { StaticImageData } from "next/image";
import cbaBasin from "../public/landing/cba/basin.png";
import nqnBasin from "../public/landing/nqn/basin.png";
import type { RegionId } from "./index";

/**
 * The landing's hero image, public/landing/<id>/basin.png: a real screenshot of the region's
 * map, or null (the cards then show no image rather than a stand-in). cba's is the owner's
 * screenshot of the whole map page (2026-10-12).
 */
export const LANDING_IMAGES: Record<RegionId, StaticImageData | null> = {
  nqn: nqnBasin,
  cba: cbaBasin,
};
