"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";
import type { Theme } from "@/lib/map/style";
import { THEME_STORAGE_KEY, useMapStore } from "@/lib/store";
import { Icon } from "./Icon";

export function ThemeToggle() {
  const t = useTranslations("theme");
  const theme = useMapStore((s) => s.theme);
  const setTheme = useMapStore((s) => s.setTheme);

  // The inline script in the layout set data-theme before hydration; adopt it.
  useEffect(() => {
    if (document.documentElement.dataset.theme === "light") setTheme("light");
  }, [setTheme]);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage blocked (private mode): the choice lasts for this page only.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="flex items-center gap-2 self-start rounded-md border border-(--border) px-2.5 py-1 hover:bg-(--panel-hover)"
    >
      <Icon name="theme" />
      {theme === "dark" ? t("toLight") : t("toDark")}
    </button>
  );
}
