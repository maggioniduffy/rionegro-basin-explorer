import type { StaticImageData } from "next/image";
import nqnBasin from "../public/landing/nqn/basin.png";
import type { RegionId } from "./index";

/** The landing's hero image, public/landing/<id>/basin.png. */
export const LANDING_IMAGES: Record<RegionId, StaticImageData> = {
  nqn: nqnBasin,
};
