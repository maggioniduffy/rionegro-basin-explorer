"use client";

import { REGION_BRANDS } from "@/regions/brand";
import { Logomark } from "../Icon";
import { useRegion } from "../RegionProvider";

/**
 * Logomark and the region's name (regions/brand.ts), a proper noun, the same in every
 * locale. `compact` (the map header) keeps only the mark below 640px; the name stays for
 * screen readers.
 */
export function Wordmark({ compact = false }: { compact?: boolean }) {
  const region = useRegion();
  return (
    <span className="flex items-center gap-2.5">
      <Logomark width={34} className="shrink-0" />
      <span
        className={`font-display font-medium tracking-[-0.01em] ${compact ? "text-[15px] max-sm:sr-only" : "text-base"}`}
      >
        {REGION_BRANDS[region]}
      </span>
    </span>
  );
}
