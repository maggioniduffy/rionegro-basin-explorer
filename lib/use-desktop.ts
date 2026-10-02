import { useSyncExternalStore } from "react";

/** Tailwind's `md` breakpoint: desktop panels at and above it, the bottom sheet below. */
const QUERY = "(min-width: 48rem)";

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/**
 * Whether the desktop layout applies; null while server-rendering and hydrating, when
 * the width is not known yet.
 */
export function useIsDesktop(): boolean | null {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => null,
  );
}
