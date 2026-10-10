import "server-only";
import { subbasinRefs, type SearchHit } from "@/lib/data/queries";
import { SEARCH_LIMIT } from "@/lib/data/params";
import { getCatalog } from "./catalog";
import { fuzzyMatch } from "./fuzzy";

/**
 * Lowest confidence the search list shows. Looser than the ask box's threshold: here the
 * user still picks from a list, so a near miss ("collon cra") is worth offering.
 */
export const SEARCH_FUZZY_MIN = 0.7;

/** Rivers and streams whose name is close to `q`, as /api/search hits. */
export async function fuzzySearchHits(q: string): Promise<SearchHit[]> {
  const { index } = await getCatalog();
  const matches = fuzzyMatch(index, q, {
    kinds: ["river", "stream"],
    limit: SEARCH_LIMIT,
  }).filter((m) => m.confidence >= SEARCH_FUZZY_MIN);
  const wanted = [...new Set(matches.flatMap((m) => m.entry.subbasin ?? []))];
  const refs = new Map((await subbasinRefs(wanted)).map((r) => [r.id, r]));
  return matches.flatMap(({ entry }): SearchHit[] => {
    if (entry.name === null) return [];
    if (entry.kind === "river")
      return [{ kind: "river", id: entry.id, name: entry.name }];
    if (entry.kind === "stream" && entry.bbox)
      return [
        {
          kind: "stream",
          id: entry.id,
          name: entry.name,
          bbox: entry.bbox,
          subbasin: entry.subbasin ? (refs.get(entry.subbasin) ?? null) : null,
        },
      ];
    return [];
  });
}
