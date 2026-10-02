"use client";

import { useIsDesktop } from "@/lib/use-desktop";
import { Controls } from "./Controls";
import { MobileSheet } from "./MobileSheet";
import { RightColumn } from "./RightColumn";

/**
 * Desktop: controls on the left, info and display panels on the right. Phones: one
 * bottom sheet holding all three. Only one layout is mounted, so the info panel and
 * the sub-basin tree fetch once; nothing renders until the width is known.
 */
export function Panels() {
  const desktop = useIsDesktop();
  if (desktop === null) return null;
  return desktop ? (
    <>
      <Controls />
      <RightColumn />
    </>
  ) : (
    <MobileSheet />
  );
}
