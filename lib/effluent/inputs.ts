/**
 * Bounds of the basic effluent inputs the panel offers. These are UI limits (what the form
 * accepts and `?ef=` can write), not physical or regulatory limits.
 */
export type InputField =
  | "flowM3s"
  | "bodMgL"
  | "coliformsPer100mL"
  | "doMgL"
  | "removalPct"
  | "doMinMgL"
  | "coliformsThreshold"
  | "tempC";

export interface InputBounds {
  min: number;
  max: number;
  /** Rounding step; null = round to `sigDigits` significant digits (and to a whole number). */
  step: number | null;
  sigDigits?: number;
}

export const INPUT_BOUNDS: Record<InputField, InputBounds> = {
  flowM3s: { min: 0.01, max: 50, step: 0.01 },
  bodMgL: { min: 0, max: 1000, step: 1 },
  coliformsPer100mL: { min: 0, max: 1e9, step: null, sigDigits: 2 },
  doMgL: { min: 0, max: 15, step: 0.1 },
  removalPct: { min: 0, max: 100, step: 1 },
  doMinMgL: { min: 0, max: 15, step: 0.1 },
  coliformsThreshold: { min: 0, max: 1e6, step: null, sigDigits: 2 },
  tempC: { min: 0, max: 35, step: 0.5 },
};

/**
 * `n` clamped to the field's bounds and rounded, as a plain-decimal number (no float noise, no
 * exponent form once printed) so `?ef=` can always write it. null when `n` is not finite.
 */
export function roundInput(field: InputField, n: number): number | null {
  if (!Number.isFinite(n)) return null;
  const { min, max, step, sigDigits } = INPUT_BOUNDS[field];
  const c = Math.min(max, Math.max(min, n));
  if (step === null) return Number(Math.round(c).toPrecision(sigDigits));
  const decimals = (String(step).split(".")[1] ?? "").length;
  return Math.min(max, Math.max(min, Number(c.toFixed(decimals))));
}
