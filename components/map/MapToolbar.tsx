"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { useRegionPath } from "@/components/RegionProvider";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SnapshotButton } from "./SnapshotButton";

const BUTTON =
  "flex size-9 items-center justify-center rounded-md hover:bg-(--panel-hover)";

/**
 * One glass card, top right: zoom, snapshot, then (from 640px up; below, the header
 * menu has them) sources, theme and language. No overflow clipping: the snapshot
 * error message sits to the left of its button.
 */
export function MapToolbar({
  onZoomIn,
  onZoomOut,
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
}) {
  const t = useTranslations("map");
  const home = useTranslations("home");
  const regionPath = useRegionPath();

  return (
    <div className="border-line bg-panel-glass shadow-card absolute top-16 right-3 flex flex-col rounded-[10px] border backdrop-blur-[6px] [&>*+*]:border-t [&>*+*]:border-(--border)">
      <button
        type="button"
        className={BUTTON}
        aria-label={t("zoomIn")}
        title={t("zoomIn")}
        onClick={onZoomIn}
      >
        <Icon name="plus" />
      </button>
      <button
        type="button"
        className={BUTTON}
        aria-label={t("zoomOut")}
        title={t("zoomOut")}
        onClick={onZoomOut}
      >
        <Icon name="minus" />
      </button>
      <SnapshotButton />
      <div className="flex flex-col max-sm:hidden [&>*+*]:border-t [&>*+*]:border-(--border)">
        <Link
          href={regionPath("/attributions")}
          aria-label={home("sources")}
          title={home("sources")}
          className={`${BUTTON} text-secondary hover:text-text`}
        >
          <Icon name="info" />
        </Link>
        <ThemeToggle iconOnly />
        <LocaleSwitcher compact />
      </div>
    </div>
  );
}
