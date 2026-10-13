import type { StaticImageData } from "next/image";
import nqnBasin from "../public/landing/nqn/basin.png";
import type { RegionId } from "./index";

/**
 * The landing's hero image, public/landing/<id>/basin.png: a real screenshot of the region's
 * map. null until the owner provides one (cba, 2026-10-12): the cards then show no image
 * rather than a stand-in.
 */
export const LANDING_IMAGES: Record<RegionId, StaticImageData | null> = {
  nqn: nqnBasin,
  cba: null,
};
