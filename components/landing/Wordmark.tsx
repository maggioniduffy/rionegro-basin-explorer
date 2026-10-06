import { Logomark } from "../Icon";

/**
 * Logomark and name. The name is a proper noun, the same in every locale. `compact`
 * (the map header) keeps only the mark below 640px; the name stays for screen readers.
 */
export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <Logomark width={34} className="shrink-0" />
      <span
        className={`font-display font-medium tracking-[-0.01em] ${compact ? "text-[15px] max-sm:sr-only" : "text-base"}`}
      >
        Río Negro Basin Explorer
      </span>
    </span>
  );
}
