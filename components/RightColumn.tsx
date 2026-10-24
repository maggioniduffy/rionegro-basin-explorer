import { InfoPanel } from "./panel/InfoPanel";

/**
 * The right column: the info panel, full height between `--panel-top` and
 * `--panel-bottom` (the edges it shares with the left panel).
 */
export function RightColumn() {
  return (
    <div className="pointer-events-none absolute top-(--panel-top) right-14 bottom-(--panel-bottom) flex w-88 flex-col gap-3">
      <InfoPanel />
    </div>
  );
}
