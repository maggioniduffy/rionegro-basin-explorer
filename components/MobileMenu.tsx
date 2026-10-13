"use client";

import { useTranslations } from "next-intl";
import { createPortal } from "react-dom";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Icon } from "./Icon";

/**
 * The hamburger shown below 640px (Tailwind `sm`). The items are children, so server
 * components can pass server-rendered links. The dropdown is a portal to <body> and
 * `position: fixed`, 16px from each side, just under the page header (measured on open):
 * inside the header, a backdrop-filter ancestor (the map's glass boxes) would become its
 * containing block and push it off-screen. Escape (focus returns to the button), a click
 * outside, a scroll, a resize and following a link close it.
 */
export function MobileMenu({
  children,
  className = "",
}: {
  children: ReactNode;
  /** Extra classes for the button. */
  className?: string;
}) {
  const t = useTranslations("menu");
  const [top, setTop] = useState<number | null>(null);
  const open = top !== null;
  const panelId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  const close = () => setTop(null);

  function toggle() {
    if (open) return close();
    const anchor = button.current?.closest("header") ?? button.current;
    setTop(Math.round((anchor?.getBoundingClientRect().bottom ?? 0) + 4));
  }

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setTop(null);
      button.current?.focus();
    }
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (!panel.current?.contains(target) && !button.current?.contains(target))
        setTop(null);
    }
    const onMove = () => setTop(null);
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("scroll", onMove, { passive: true });
    window.addEventListener("resize", onMove);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", onMove);
      window.removeEventListener("resize", onMove);
    };
  }, [open]);

  return (
    <div className="sm:hidden">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={open ? t("close") : t("open")}
        onClick={toggle}
        className={`text-text hover:text-accent pointer-events-auto inline-flex size-11 items-center justify-center rounded-full ${className}`}
      >
        <Icon name={open ? "close" : "menu"} size={24} />
      </button>
      {open &&
        createPortal(
          <div
            ref={panel}
            id={panelId}
            onClick={(e) => {
              if ((e.target as HTMLElement).closest("a")) close();
            }}
            style={{ top, maxHeight: `calc(100dvh - ${top}px - 16px)` }}
            className="bg-panel-glass border-line shadow-card text-text fixed inset-x-4 z-60 flex flex-col items-stretch gap-1 overflow-y-auto rounded-[14px] border p-3 text-sm backdrop-blur-[10px] [&_[role=group]>*]:min-h-10 [&_[role=group]>*]:flex-1 [&_[role=group]>*]:justify-center"
          >
            {children}
          </div>,
          document.body,
        )}
    </div>
  );
}
