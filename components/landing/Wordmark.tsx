"use client";

import { REGION_BRANDS } from "@/regions/brand";
import { Logomark } from "../Icon";
import { useRegion } from "../RegionProvider";

/**
 * Logomark and the region's name (regions/brand.ts), a proper noun, the same in every
 * locale. `compact` (the map header) keeps only the mark below 640px; the name stays for
 * screen readers.
 */
export function Wordmark({
  compact = false,
  large = false,
  phoneMark = false,
}: {
  compact?: boolean;
  /** Below 640px, the mark only (the name stays for screen readers). */
  phoneMark?: boolean;
  /** The footer's 17px name. */
  large?: boolean;
}) {
  const region = useRegion();
  return (
    <span className="flex items-center gap-2.5">
      <Logomark width={34} className="shrink-0" />
      <span
        className={`font-sans font-medium tracking-[-0.01em] ${compact ? "text-[15px]" : large ? "text-[17px]" : "text-base"} ${compact || phoneMark ? "max-sm:sr-only" : ""}`}
      >
        {REGION_BRANDS[region]}
      </span>
    </span>
  );
}
