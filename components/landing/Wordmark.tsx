import { Logomark } from "../Icon";

/** Logomark and name. The name is a proper noun, the same in every locale. */
export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <Logomark width={34} className="shrink-0" />
      <span
        className={`font-display font-medium tracking-[-0.01em] ${compact ? "text-[15px]" : "text-base"}`}
      >
        Río Negro Basin Explorer
      </span>
    </span>
  );
}
