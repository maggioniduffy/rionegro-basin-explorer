"use client";

import { BaseLayerToggle } from "./BaseLayerToggle";
import { LayerToggles } from "./LayerToggles";
import { MinimapSection } from "./Minimap";
import { UnitsToggle } from "./UnitsToggle";

/** Minimap (when asked), units and layer toggles. */
export function DisplayOptionsContent({ minimap }: { minimap: boolean }) {
  return (
    <>
      {minimap && <MinimapSection />}
      <BaseLayerToggle />
      <UnitsToggle />
      <LayerToggles />
    </>
  );
}
