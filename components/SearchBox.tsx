"use client";

import { useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";
import type { SearchHit } from "@/lib/data/queries";
import { parseSearchQuery } from "@/lib/data/params";
import { useMapStore } from "@/lib/store";
import { useApi } from "@/lib/use-api";
import { AskAnswerCard } from "./AskAnswer";
import { Icon } from "./Icon";
import { useSubbasinLabel } from "./panel/subbasin-label";
import { useAsk } from "./use-ask";

const DEBOUNCE_MS = 200;

/** Three words or more, or a question mark, read as a question rather than a name. */
function looksLikeQuestion(text: string): boolean {
  return /[?¿]/.test(text) || text.trim().split(/\s+/).length >= 3;
}

/**
 * The one bar for names and questions (combobox): suggestions from /api/search for river,
 * IGN-stream and HYRIV_ID names, and a last option that sends the text to /api/ask. Type,
 * pick with arrows + Enter or a click. Answers open as a card under the bar.
 */
export function SearchBox() {
  const t = useTranslations("search");
  const tReach = useTranslations("panel.reach");
  const subbasinLabel = useSubbasinLabel();
  const select = useMapStore((s) => s.select);
  const { ask, loading, result, notice, clear } = useAsk();
  const listId = useId();
  const [text, setText] = useState("");
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  // null = the default option (see defaultIndex); set by arrows and by the mouse.
  const [active, setActive] = useState<number | null>(null);

  const parsed = parseSearchQuery(text);
  useEffect(() => {
    const id = setTimeout(() => setQuery(parsed), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [parsed]);

  const state = useApi<SearchHit[]>(
    query ? `/api/search?q=${encodeURIComponent(query)}` : null,
  );
  const hits = query && state.status === "ok" ? state.data : [];
  // Suggestions for the current text are still on their way.
  const pending =
    parsed !== query || (query !== null && state.status === "loading");
  const hasText = text.trim() !== "";
  const showList = open && hasText;
  // The Ask option always ends the list.
  const askIndex = hits.length;
  const optionCount = hasText ? hits.length + 1 : 0;
  const defaultIndex =
    hits.length === 0 || looksLikeQuestion(text) ? askIndex : 0;
  const activeIndex = Math.min(active ?? defaultIndex, askIndex);

  function choose(hit: SearchHit) {
    // A river or an IGN stream fits to the whole of it. A typed HYRIV_ID opens that reach.
    select(
      hit.kind === "river" || hit.kind === "stream"
        ? { kind: hit.kind, id: hit.id }
        : { kind: "reach", id: Number(hit.id) },
      { fit: true },
    );
    clear();
    setText("");
    setOpen(false);
  }

  function submitQuestion(question: string) {
    setText(question);
    setOpen(false);
    void ask(question).then((selected) => {
      if (selected) setText("");
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      if (optionCount > 0) {
        const step = e.key === "ArrowDown" ? 1 : -1;
        setActive((activeIndex + step + optionCount) % optionCount);
      }
    } else if (e.key === "Enter") {
      if (!hasText) return;
      e.preventDefault();
      if (activeIndex === askIndex) {
        // A name typed faster than the suggestions arrive is not yet a question.
        if (pending && active === null && !looksLikeQuestion(text)) return;
        submitQuestion(text);
      } else {
        const hit = hits[activeIndex];
        if (hit) choose(hit);
      }
    } else if (e.key === "Escape" && (open || text || result || notice)) {
      // Handled here: the info panel ignores an Escape that closed the search.
      e.preventDefault();
      setOpen(false);
      setText("");
      clear();
    }
  }

  return (
    <div className="relative w-full sm:max-w-96">
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
        aria-busy={loading}
        aria-activedescendant={
          showList ? `${listId}-${activeIndex}` : undefined
        }
        placeholder={t("placeholder")}
        value={text}
        // Keep in step with ASK_MAX_LENGTH in lib/ask/query.ts (server-only module).
        // /api/search only gets texts up to 64 characters (parseSearchQuery).
        maxLength={120}
        autoComplete="off"
        onChange={(e) => {
          setText(e.target.value);
          setActive(null);
          setOpen(true);
          if (result || notice) clear();
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        className="bg-panel-glass min-h-9 w-full rounded-md border border-(--border) py-1.5 pr-3 pl-8 text-sm shadow backdrop-blur-[6px] placeholder:text-(--muted) focus:ring-2 focus:ring-(--accent) focus:outline-none"
      />
      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label={t("label")}
          className="shadow-card absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-md border border-(--border) bg-(--panel) text-sm backdrop-blur-[6px]"
        >
          {state.status === "error" && (
            <li role="presentation" className="text-muted px-3 py-2">
              {t("error")}
            </li>
          )}
          {query !== null && state.status === "ok" && hits.length === 0 && (
            <li role="presentation" className="text-muted px-3 py-2">
              {t("noResults")}
            </li>
          )}
          {hits.map((hit, i) => (
            <li
              key={`${hit.kind}:${hit.id}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              // mousedown, not click: the input's blur would close the list first.
              onMouseDown={(e) => {
                e.preventDefault();
                choose(hit);
              }}
              onMouseEnter={() => setActive(i)}
              className={`cursor-pointer px-3 py-2 ${i === activeIndex ? "bg-(--panel-hover)" : ""}`}
            >
              {hit.kind === "reachId" ? (
                <>
                  {tReach("id", { id: hit.id })}
                  {hit.name && (
                    <span className="text-muted"> · {hit.name}</span>
                  )}
                </>
              ) : hit.kind === "stream" ? (
                <>
                  {hit.name}
                  {hit.subbasin && (
                    <span className="text-muted">
                      {" "}
                      · {subbasinLabel(hit.subbasin)}
                    </span>
                  )}
                </>
              ) : (
                hit.name
              )}
            </li>
          ))}
          <li
            id={`${listId}-${askIndex}`}
            role="option"
            aria-selected={askIndex === activeIndex}
            onMouseDown={(e) => {
              e.preventDefault();
              submitQuestion(text);
            }}
            onMouseEnter={() => setActive(askIndex)}
            className={`flex cursor-pointer items-center gap-2 px-3 py-2 ${hits.length > 0 ? "border-t border-(--border)" : ""} ${askIndex === activeIndex ? "bg-(--panel-hover)" : ""}`}
          >
            <span className="truncate">{t("ask", { text: text.trim() })}</span>
          </li>
        </ul>
      )}
      <AskAnswerCard
        loading={loading}
        result={result}
        notice={notice}
        onClose={clear}
        onAsk={submitQuestion}
      />
    </div>
  );
}
