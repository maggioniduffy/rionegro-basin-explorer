"use client";

import { useEffect, useState } from "react";
import { useRegion } from "@/components/RegionProvider";
import { FLOW_VERSIONS } from "@/lib/map/config";
import type { RegionId } from "@/regions";
import { z } from "zod";
import { flowNetPubSchema, type FlowNetPub } from "./net-pub-schema";
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
    nets: `${base}/nets.json`,
    net: (id: string) => `${base}/${id}.net.json`,
  };
}

/** public/flow/<region>/nets.json: the sections that have a published net, and the reservoir ones. */
const netsManifestSchema = z.strictObject({
  region: z.string().min(1),
  ids: z.array(z.string()),
  reservoirSections: z.array(z.string()),
});
export type FlowNets = z.infer<typeof netsManifestSchema>;

const noNets = (region: RegionId): FlowNets => ({
  region,
  ids: [],
  reservoirSections: [],
});

/**
 * Whether the flow view offers a section: flowable in the index, or a reservoir section the
 * nets manifest lists (those animate on their net and drift). The single place that decides.
 */
export const isSectionFlowable = (
  entry: { id: string; flowable: boolean },
  nets: Pick<FlowNets, "reservoirSections">,
) => entry.flowable || nets.reservoirSections.includes(entry.id);

const indexes = new Map<RegionId, Promise<FlowIndex | null>>();
const sections = new Map<string, Promise<FlowSection | null>>();
// Resolved values, for code that cannot wait (map click handlers).
const loadedIndexes = new Map<RegionId, FlowIndex>();
const loadedSections = new Map<string, FlowSection>();
const netsManifests = new Map<RegionId, Promise<FlowNets>>();
const nets = new Map<string, Promise<FlowNetPub | null>>();
const loadedNets = new Map<string, FlowNetPub>();

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

/**
 * The region's nets manifest. A missing nets.json (404) or a region with no flow data means
 * "no nets" (empty manifest), not an error; any other failure logs, also gives the empty
 * manifest, and is retried on the next call.
 */
export function loadNets(region: RegionId): Promise<FlowNets> {
  const paths = flowPaths(region);
  if (!paths) return Promise.resolve(noNets(region));
  let p = netsManifests.get(region);
  if (!p) {
    p = fetch(paths.nets)
      .then(async (res) => {
        if (res.status === 404) return noNets(region);
        if (!res.ok) throw new Error(`${paths.nets}: ${res.status}`);
        const parsed = netsManifestSchema.safeParse(await res.json());
        if (!parsed.success || parsed.data.region !== region)
          throw new Error("flow nets manifest: unexpected shape");
        return parsed.data;
      })
      .catch((err: unknown) => {
        console.error(err);
        netsManifests.delete(region);
        return noNets(region);
      });
    netsManifests.set(region, p);
  }
  return p;
}

/** One published net; null for an id that isn't a section id, or on a failed load. */
export function loadNet(
  region: RegionId,
  id: string,
): Promise<FlowNetPub | null> {
  const paths = flowPaths(region);
  if (!paths || !parseSectionId(id)) return Promise.resolve(null);
  const key = `${region}/${id}`;
  let p = nets.get(key);
  if (!p) {
    p = fetchJson(paths.net(id))
      .then((raw) => {
        const parsed = flowNetPubSchema.safeParse(raw);
        if (!parsed.success || parsed.data.region !== region)
          throw new Error(`flow net ${id}: bad shape`);
        loadedNets.set(key, parsed.data);
        return parsed.data;
      })
      .catch((err: unknown) => {
        console.error(err);
        nets.delete(key);
        return null;
      });
    nets.set(key, p);
  }
  return p;
}

/** The net if it has already loaded. */
export const peekNet = (region: RegionId, id: string) =>
  loadedNets.get(`${region}/${id}`);

/**
 * The region's section index; null if the region has no flow data or it can't be loaded.
 * `flowable` is already merged with the nets manifest (isSectionFlowable), so every reader
 * (buttons, nearest section, switching, panels) agrees; reservoir sections read as flowable
 * with no reason.
 */
export function loadFlowIndex(region: RegionId): Promise<FlowIndex | null> {
  const paths = flowPaths(region);
  if (!paths) return Promise.resolve(null);
  let p = indexes.get(region);
  if (!p) {
    p = Promise.all([fetchJson(paths.index), loadNets(region)])
      .then(([raw, manifest]) => {
        const parsed = flowIndexSchema.safeParse(raw);
        if (!parsed.success) throw new Error("flow index: unexpected shape");
        const merged: FlowIndex = {
          ...parsed.data,
          rivers: parsed.data.rivers.map((r) => ({
            ...r,
            sections: r.sections.map((s) =>
              !s.flowable && isSectionFlowable(s, manifest)
                ? { ...s, flowable: true, reason: null }
                : s,
            ),
          })),
        };
        loadedIndexes.set(region, merged);
        return merged;
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
