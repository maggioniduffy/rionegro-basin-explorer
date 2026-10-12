/**
 * Where the water of a reach ends (R3.7, reference regions such as cba). Pure, so it is
 * unit-tested without DuckDB (tests/pipeline/mouth-kind.test.ts).
 *
 * HydroRIVERS ends every flow path at a reach with NEXT_DOWN = 0: a river mouth at the sea or
 * an endorheic sink. In a reference region (pipeline:rivers, runReference) the path can also
 * end because the network was edited (`next_down_edit`): 'outside' = the reach flows on
 * outside the region's selection, 'cut' = it flows into another root. The kind of a terminal
 * reach, by these source fields only:
 *
 *   next_down_edit = 'outside'              -> "region-edge": the water leaves the mapped region
 *   ENDORHEIC = 1 or network = 'endorheic'  -> "sink": an endorheic sink (drains inland)
 *   no edit, ENDORHEIC = 0, connected       -> "sea"
 *
 * A 'cut' terminal that is neither endorheic nor on the endorheic network would be a path into
 * another root with no sink flag: there is no source field to name its end, so it throws
 * rather than guess (CLAUDE.md rule 2).
 */
import type { MouthKind } from "../../lib/data/mouth";

export type { MouthKind };

export interface NetworkReach {
  id: number;
  /** HYRIV_ID downstream; 0 (or an id not in the input) ends the walk. */
  nextDown: number;
  /** pipeline:rivers `next_down_edit` ('cut' | 'outside' | 'override' | null). */
  nextDownEdit: string | null;
  /** HydroRIVERS ENDORHEIC (1 = the reach drains to an endorheic sink). */
  endorheic: boolean;
  /** pipeline:rivers `network`: 'connected' | 'endorheic'. */
  network: string;
}

/** The kind of a terminal reach (see the file header). */
export function terminalKind(
  r: Pick<NetworkReach, "id" | "nextDownEdit" | "endorheic" | "network">,
): MouthKind {
  if (r.nextDownEdit === "outside") return "region-edge";
  if (r.endorheic || r.network === "endorheic") return "sink";
  if (r.nextDownEdit === "cut")
    throw new Error(
      `reach ${r.id} flows into another root (next_down_edit = 'cut') but is not endorheic: its end cannot be named from the source fields`,
    );
  return "sea";
}

/**
 * The kind of the end of the flow path from every reach (itself included). Paths are
 * followed down with memoization; a cycle (a data error) throws.
 */
export function mouthKinds(
  reaches: readonly NetworkReach[],
): Map<number, MouthKind> {
  const byId = new Map(reaches.map((r) => [r.id, r]));
  const kinds = new Map<number, MouthKind>();
  for (const start of reaches) {
    if (kinds.has(start.id)) continue;
    const path: number[] = [];
    const seen = new Set<number>();
    let at: NetworkReach = start;
    let kind: MouthKind | undefined;
    for (;;) {
      const known = kinds.get(at.id);
      if (known !== undefined) {
        kind = known;
        break;
      }
      if (seen.has(at.id)) throw new Error(`flow cycle through reach ${at.id}`);
      seen.add(at.id);
      path.push(at.id);
      const next = byId.get(at.nextDown);
      if (at.nextDown === 0 || !next) {
        // A NEXT_DOWN that is neither 0 nor a known reach is a broken edge, not an end.
        if (at.nextDown !== 0)
          throw new Error(
            `reach ${at.id}: NEXT_DOWN ${at.nextDown} is not in the network`,
          );
        kind = terminalKind(at);
        break;
      }
      at = next;
    }
    for (const id of path) kinds.set(id, kind);
  }
  return kinds;
}

/**
 * The `flowsInto` of a river that flows into no other approved river, from the kind of its
 * end. Regions without kinds (nqn) pass undefined and keep "sea".
 */
export function terminalFlowsInto(kind: MouthKind | undefined): MouthKind {
  return kind ?? "sea";
}
