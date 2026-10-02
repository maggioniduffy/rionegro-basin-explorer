/**
 * Number formatting for the panels, by locale. Units are symbols (km, m, m³/s) and
 * are not translated. A km/mi toggle is planned for Phase 7.
 */
export type Quantity = "km" | "m" | "km2" | "m3s" | "mPerKm" | "pct" | "count";

const SUFFIX: Partial<Record<Quantity, string>> = {
  km2: " km²",
  m3s: " m³/s",
  mPerKm: " m/km",
};

function options(q: Quantity, value: number): Intl.NumberFormatOptions {
  switch (q) {
    case "km":
      return { style: "unit", unit: "kilometer", maximumFractionDigits: 1 };
    case "m":
      return { style: "unit", unit: "meter", maximumFractionDigits: 0 };
    case "km2":
      // Ponds and small lakes are fractions of a square kilometre.
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

export function formatQuantity(
  locale: string,
  q: Quantity,
  value: number,
): string {
  const v = q === "pct" ? value / 100 : value;
  return (
    new Intl.NumberFormat(locale, options(q, value)).format(v) +
    (SUFFIX[q] ?? "")
  );
}
