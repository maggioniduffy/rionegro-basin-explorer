/**
 * Where a river's water ends. A river's `flowsInto` is the slug of the approved river it joins,
 * or, when it joins none, one of these words. `mouthKind` (rivers of reference regions only,
 * R3.7) is the end of the whole downstream path, even through other rivers. Shared by the
 * pipeline, the schemas and the panels; no server imports.
 *
 *   sea          the path reaches a river mouth at the sea (the only value for nqn)
 *   sink         it ends in an endorheic sink: the water drains inland
 *   region-edge  it leaves the mapped region (the path goes on outside the data)
 */
export const MOUTH_KINDS = ["sea", "sink", "region-edge"] as const;
export type MouthKind = (typeof MOUTH_KINDS)[number];

export const isMouthKind = (v: unknown): v is MouthKind =>
  MOUTH_KINDS.some((k) => k === v);
