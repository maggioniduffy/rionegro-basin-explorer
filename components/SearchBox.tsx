"use client";

import { useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";
import type { SearchHit } from "@/lib/data/queries";
import { parseSearchQuery } from "@/lib/data/params";
import { useMapStore } from "@/lib/store";
import { useApi } from "@/lib/use-api";
import { Icon } from "./Icon";

const DEBOUNCE_MS = 200;

/** River and IGN-name search (combobox): type, pick with arrows + Enter or a click. */
export function SearchBox() {
  const t = useTranslations("search");
  const select = useMapStore((s) => s.select);
  const listId = useId();
  const [text, setText] = useState("");
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const id = setTimeout(() => setQuery(parseSearchQuery(text)), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [text]);

  const state = useApi<SearchHit[]>(
    query ? `/api/search?q=${encodeURIComponent(query)}` : null,
  );
  const hits = query && state.status === "ok" ? state.data : [];
  const showList = open && query !== null && state.status !== "loading";

  function choose(hit: SearchHit) {
    // A river fits to the whole river; an IGN name opens its longest reach and fits to it.
    select(
      hit.kind === "river"
        ? { kind: "river", id: hit.id }
        : { kind: "reach", id: Number(hit.id) },
      { fit: true },
    );
    setText("");
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      if (hits.length > 0) {
        const step = e.key === "ArrowDown" ? 1 : -1;
        setActive((a) => (a + step + hits.length) % hits.length);
      }
    } else if (e.key === "Enter") {
      const hit = hits[active] ?? hits[0];
      if (hit) {
        e.preventDefault();
        choose(hit);
      }
    } else if (e.key === "Escape" && (open || text)) {
      // Handled here: the info panel ignores an Escape that closed the search.
      e.preventDefault();
      setOpen(false);
      setText("");
    }
  }

  return (
    <div className="relative w-full max-w-64">
      <Icon
        name="search"
        className="text-muted pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2"
      />
      <input
        type="search"
        role="combobox"
        aria-label={t("label")}
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          showList && hits[active] ? `${listId}-${active}` : undefined
        }
        placeholder={t("placeholder")}
        value={text}
        maxLength={64}
        onChange={(e) => {
          setText(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        className="w-full rounded-md border border-(--border) bg-(--panel) py-1.5 pr-3 pl-8 text-sm shadow backdrop-blur placeholder:text-(--muted) focus:ring-2 focus:ring-sky-400/60 focus:outline-none"
      />
      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label={t("label")}
          className="absolute inset-x-0 top-full mt-1 overflow-hidden rounded-md border border-(--border) bg-(--panel) text-sm shadow-lg backdrop-blur"
        >
          {state.status === "error" && (
            <li className="text-muted px-3 py-2">{t("error")}</li>
          )}
          {state.status === "ok" && hits.length === 0 && (
            <li className="text-muted px-3 py-2">{t("noResults")}</li>
          )}
          {hits.map((hit, i) => (
            <li
              key={`${hit.kind}:${hit.id}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              // mousedown, not click: the input's blur would close the list first.
              onMouseDown={(e) => {
                e.preventDefault();
                choose(hit);
              }}
              onMouseEnter={() => setActive(i)}
              className={`cursor-pointer px-3 py-2 ${i === active ? "bg-(--panel-hover)" : ""}`}
            >
              {hit.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
