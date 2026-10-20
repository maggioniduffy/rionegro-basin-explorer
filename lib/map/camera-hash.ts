/**
 * Whether the page was opened with a MapLibre camera hash (`#zoom/lat/lon[/bearing/pitch]`).
 * Read once, before the map exists: MapLibre starts rewriting the hash as soon as it is built.
 */
let hadCameraHash: boolean | undefined;

export function openedWithCameraHash(): boolean {
  if (hadCameraHash === undefined) {
    const parts = window.location.hash.replace(/^#/, "").split("/");
    hadCameraHash =
      parts.length >= 3 &&
      parts.slice(0, 3).every((p) => p !== "" && Number.isFinite(+p)) &&
      Math.abs(Number(parts[1])) <= 90 &&
      Math.abs(Number(parts[2])) <= 180;
  }
  return hadCameraHash;
}
