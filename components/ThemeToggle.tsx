"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";
import type { Theme } from "@/lib/map/style";
import { useMapStore } from "@/lib/store";
import { saveTheme } from "@/lib/theme-tokens";
import { Icon } from "./Icon";

/**
 * Dark/light switch. `data-theme` on <html> is the one source of truth: the server sets
 * it from the theme cookie (app/layout.tsx), and the map follows the store, which
 * adopts it on mount. No aria-pressed: the label names the action (DECISSIONS Phase 8).
 */
export function ThemeToggle({
  compact = false,
  className = "",
}: {
  /** Below 640px, the icon only (the label stays for screen readers). */
  compact?: boolean;
  className?: string;
}) {
  const t = useTranslations("theme");
  const theme = useMapStore((s) => s.theme);
  const setTheme = useMapStore((s) => s.setTheme);

  useEffect(() => {
    setTheme(
      document.documentElement.dataset.theme === "light" ? "light" : "dark",
    );
  }, [setTheme]);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    if (next === "light") document.documentElement.dataset.theme = "light";
    else delete document.documentElement.dataset.theme;
    saveTheme(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title={t("toggle")}
      className={`border-line text-strong-muted hover:border-accent inline-flex min-h-9 shrink-0 cursor-pointer items-center gap-2 rounded-md border px-3 text-[13px] transition-colors ${className}`}
    >
      <Icon name="theme" />
      <span className={compact ? "max-sm:sr-only" : undefined}>
        {theme === "dark" ? t("toLight") : t("toDark")}
      </span>
    </button>
  );
}
