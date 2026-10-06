"use client";

import type { Quantity } from "@/lib/units";
import { useAdoptSavedUnits } from "@/lib/use-saved-units";
import { useFormat } from "../panel/parts";

/** A value from app/landing-sample.json, in the locale and the saved km/mi choice. */
export function SampleValue({ q, value }: { q: Quantity; value: number }) {
  useAdoptSavedUnits();
  const f = useFormat();
  return <>{f(q, value)}</>;
}
