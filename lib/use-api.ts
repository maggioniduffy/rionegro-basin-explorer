"use client";

import { useEffect, useState } from "react";
import { useRegionPath } from "@/components/RegionProvider";

export type ApiState<T> =
  | { status: "loading" }
  | { status: "ok"; data: T }
  | { status: "notFound" }
  | { status: "error" };

/**
 * GET a JSON API path of the current region (`/api/search` -> `/cordoba/api/search`); `null`
 * skips the request. Aborts when the path changes.
 */
export function useApi<T>(apiPath: string | null): ApiState<T> {
  const inRegion = useRegionPath();
  const path = apiPath === null ? null : inRegion(apiPath);
  const [state, setState] = useState<{ path: string | null; s: ApiState<T> }>({
    path,
    s: { status: "loading" },
  });

  useEffect(() => {
    if (!path) return;
    const ctrl = new AbortController();
    fetch(path, { signal: ctrl.signal })
      .then(async (res) => {
        const s: ApiState<T> = res.ok
          ? { status: "ok", data: (await res.json()) as T }
          : { status: res.status === 404 ? "notFound" : "error" };
        setState({ path, s });
      })
      .catch((err: unknown) => {
        if (!ctrl.signal.aborted) {
          console.error(err);
          setState({ path, s: { status: "error" } });
        }
      });
    return () => ctrl.abort();
  }, [path]);

  // A result for an earlier path is stale: show loading until the new one arrives.
  return state.path === path ? state.s : { status: "loading" };
}
