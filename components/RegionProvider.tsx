"use client";

import { createContext, useCallback, useContext, type ReactNode } from "react";
import { DEFAULT_REGION, regionPath, type RegionId } from "@/regions";

const RegionContext = createContext<RegionId>(DEFAULT_REGION);

/** The region of the current path (app/[region]/layout.tsx), for client components. */
export function RegionProvider({
  region,
  children,
}: {
  region: RegionId;
  children: ReactNode;
}) {
  return <RegionContext value={region}>{children}</RegionContext>;
}

export const useRegion = () => useContext(RegionContext);

/** A path inside the current region (/map -> /cordoba/map), for links and API calls. */
export function useRegionPath(): (path: string) => string {
  const region = useRegion();
  return useCallback((path: string) => regionPath(region, path), [region]);
}
