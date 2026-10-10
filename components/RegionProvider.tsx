"use client";

import { createContext, useContext, type ReactNode } from "react";
import { DEFAULT_REGION, type RegionId } from "@/regions";

const RegionContext = createContext<RegionId>(DEFAULT_REGION);

/** The region of the current host (app/[region]/layout.tsx), for client components. */
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
