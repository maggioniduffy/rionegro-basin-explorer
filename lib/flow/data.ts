"use client";

import { useEffect, useState } from "react";
import { useRegion } from "@/components/RegionProvider";
import { FLOW_VERSIONS } from "@/lib/map/config";
import type { RegionId } from "@/regions";
import {
  flowIndexSchema,
  flowSectionSchema,
  parseSectionId,
  type FlowIndex,
  type FlowSection,
} from "./schema";

/**
 * Versioned URLs of a region's flow files (public/flow/<region>/, hashed in next.config.ts like
 * the tiles), or null when the region has none: no flow mode, and no request for another
 * region's files.
 */
export function flowPaths(region: RegionId, versions = FLOW_VERSIONS) {
  const version = versions[region];
  if (!version) return null;
  const base = `/flow/${region}/${version}`;
  return {
    index: `${base}/index.json`,
    section: (id: string) => `${base}/${id}.json`,
  };
}

const indexes = new Map<RegionId, Promise<FlowIndex | null>>();
const sections = new Map<string, Promise<FlowSection | null>>();
// Resolved values, for code that cannot wait (map click handlers).
const loadedIndexes = new Map<RegionId, FlowIndex>();
const loadedSections = new Map<string, FlowSection>();

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

/** The region's section index; null if the region has no flow data or it can't be loaded. */
export function loadFlowIndex(region: RegionId): Promise<FlowIndex | null> {
  const paths = flowPaths(region);
  if (!paths) return Promise.resolve(null);
  let p = indexes.get(region);
  if (!p) {
    p = fetchJson(paths.index)
      .then((raw) => {
        const parsed = flowIndexSchema.safeParse(raw);
        if (!parsed.success) throw new Error("flow index: unexpected shape");
        loadedIndexes.set(region, parsed.data);
        return parsed.data;
      })
      .catch((err: unknown) => {
        console.error(err);
        indexes.delete(region); // allow a retry
        return null;
      });
    indexes.set(region, p);
  }
  return p;
}

/** The index if it has already loaded. */
export const peekFlowIndex = (region: RegionId) => loadedIndexes.get(region);

/** One section file; null for an id that isn't a section id, or on a failed load. */
export function loadSection(
  region: RegionId,
  id: string,
): Promise<FlowSection | null> {
  const paths = flowPaths(region);
  if (!paths || !parseSectionId(id)) return Promise.resolve(null);
  const key = `${region}/${id}`;
  let p = sections.get(key);
  if (!p) {
    p = fetchJson(paths.section(id))
      .then((raw) => {
        const parsed = flowSectionSchema.safeParse(raw);
        if (!parsed.success) throw new Error(`flow section ${id}: bad shape`);
        loadedSections.set(key, parsed.data);
        return parsed.data;
      })
      .catch((err: unknown) => {
        console.error(err);
        sections.delete(key);
        return null;
      });
    sections.set(key, p);
  }
  return p;
}

/** The section if it has already loaded. */
export const peekSection = (region: RegionId, id: string) =>
  loadedSections.get(`${region}/${id}`);

/** The current region's flow index: null until it loads, and for a region with no flow data. */
export function useFlowIndex(): FlowIndex | null {
  const region = useRegion();
  const [loaded, setLoaded] = useState<{
    region: RegionId;
    index: FlowIndex | null;
  } | null>(null);
  useEffect(() => {
    let alive = true;
    void loadFlowIndex(region).then((index) => {
      if (alive) setLoaded({ region, index });
    });
    return () => {
      alive = false;
    };
  }, [region]);
  return loaded?.region === region ? loaded.index : null;
}
