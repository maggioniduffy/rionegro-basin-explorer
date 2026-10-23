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

/**
 * MapLibre's `map.remove()` deletes the hash from the URL, so a remount (React StrictMode in
 * dev, or any effect re-run) would lose the camera and fall back to the basin fit. The hash is
 * kept before removal and put back before the next map is built on the same page; another page
 * (a region switch) never inherits it.
 */
let kept: { pathname: string; hash: string } | null = null;

export function keepCameraHash(): void {
  const { pathname, hash } = window.location;
  kept = hash ? { pathname, hash } : null;
}

export function restoreCameraHash(): void {
  const k = kept;
  kept = null;
  const { pathname, search, hash } = window.location;
  if (!k || hash || k.pathname !== pathname) return;
  window.history.replaceState(
    window.history.state,
    "",
    `${pathname}${search}${k.hash}`,
  );
}
