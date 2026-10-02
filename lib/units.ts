/**
 * Number formatting for the panels, by locale and unit system. Unit symbols (km, mi,
 * m³/s) are not translated. The km/mi toggle is independent of the locale; discharge
 * stays in m³/s in both systems.
 */
export type Quantity = "km" | "m" | "km2" | "m3s" | "mPerKm" | "pct" | "count";

export const UNIT_SYSTEMS = ["metric", "imperial"] as const;
export type UnitSystem = (typeof UNIT_SYSTEMS)[number];

/** Exact by definition: 1 mi = 1.609344 km, 1 ft = 0.3048 m. */
const KM_PER_MI = 1.609344;
const M_PER_FT = 0.3048;

/** Factor from the stored metric value to the imperial unit shown. */
const TO_IMPERIAL: Partial<Record<Quantity, number>> = {
  km: 1 / KM_PER_MI,
  m: 1 / M_PER_FT,
  km2: 1 / (KM_PER_MI * KM_PER_MI),
  // m/km → ft/mi: (1 / 0.3048) × 1.609344 = 5.28.
  mPerKm: KM_PER_MI / M_PER_FT,
};

const SUFFIX: Record<UnitSystem, Partial<Record<Quantity, string>>> = {
  metric: { km2: " km²", m3s: " m³/s", mPerKm: " m/km" },
  imperial: { km2: " mi²", m3s: " m³/s", mPerKm: " ft/mi" },
};

const UNIT: Record<UnitSystem, { km: string; m: string }> = {
  metric: { km: "kilometer", m: "meter" },
  imperial: { km: "mile", m: "foot" },
};

function options(
  q: Quantity,
  value: number,
  system: UnitSystem,
): Intl.NumberFormatOptions {
  switch (q) {
    case "km":
      return { style: "unit", unit: UNIT[system].km, maximumFractionDigits: 1 };
    case "m":
      return { style: "unit", unit: UNIT[system].m, maximumFractionDigits: 0 };
    case "km2":
      // Ponds and small lakes are fractions of a square kilometre (or mile).
      return Math.abs(value) < 10
        ? { maximumSignificantDigits: 2 }
        : { maximumFractionDigits: 0 };
    case "count":
      return { maximumFractionDigits: 0 };
    case "m3s":
      // Small streams carry fractions of a cubic metre per second.
      return Math.abs(value) < 10
        ? { maximumSignificantDigits: 2 }
        : { maximumFractionDigits: 1 };
    case "mPerKm":
      return { maximumFractionDigits: 2 };
    case "pct":
      return { style: "percent", maximumFractionDigits: 1 };
  }
}

/** Formats a metric value (as stored) in `system`'s unit. */
export function formatQuantity(
  locale: string,
  q: Quantity,
  value: number,
  system: UnitSystem = "metric",
): string {
  const converted =
    system === "imperial" ? value * (TO_IMPERIAL[q] ?? 1) : value;
  const v = q === "pct" ? converted / 100 : converted;
  return (
    new Intl.NumberFormat(locale, options(q, converted, system)).format(v) +
    (SUFFIX[system][q] ?? "")
  );
}
