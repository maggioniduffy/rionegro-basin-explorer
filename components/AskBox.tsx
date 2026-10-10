"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import type { AskResult } from "@/lib/ask/contract";
import { useMapStore } from "@/lib/store";

type Notice = "noMatch" | "unsupported" | "rateLimited" | "error";

const EXAMPLES = ["0", "1", "2"] as const;

/**
 * Natural-language question box: POSTs to /api/ask and selects the river, sub-basin or
 * stream the answer names. Sits next to the search box in the map header; messages and the
 * example chips open as a dropdown under the input so the header keeps its height.
 */
export function AskBox() {
  const t = useTranslations("ask");
  const locale = useLocale();
  const select = useMapStore((s) => s.select);
  const inputId = useId();
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const controller = useRef<AbortController | null>(null);

  // Drop an in-flight request when the box goes away.
  useEffect(() => () => controller.current?.abort(), []);

  async function ask(question: string) {
    const q = question.trim();
    if (!q) return;
    controller.current?.abort();
    const mine = new AbortController();
    controller.current = mine;
    setLoading(true);
    setNotice(null);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ q, locale }),
        signal: mine.signal,
      });
      if (mine.signal.aborted) return;
      if (res.status === 429) {
        setNotice("rateLimited");
        return;
      }
      if (!res.ok) {
        setNotice("error");
        return;
      }
      const result = (await res.json()) as AskResult;
      if (mine.signal.aborted) return;
      if (result.action === "select") {
        select({ kind: result.kind, id: result.id }, { fit: true });
        setText("");
        setNotice(null);
      } else {
        setNotice(result.action === "no_match" ? "noMatch" : "unsupported");
      }
    } catch {
      // A superseded or unmounted request aborts; only a real failure shows a message.
      if (!mine.signal.aborted) setNotice("error");
    } finally {
      if (controller.current === mine) {
        controller.current = null;
        setLoading(false);
      }
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLFormElement>) {
    if (e.key === "Escape" && (text || notice)) {
      // Handled here: the info panel ignores an Escape that cleared the box.
      e.preventDefault();
      setText("");
      setNotice(null);
    }
  }

  return (
    <form
      role="search"
      aria-label={t("label")}
      aria-busy={loading}
      onSubmit={(e) => {
        e.preventDefault();
        void ask(text);
      }}
      onKeyDown={onKeyDown}
      className="relative w-full"
    >
      <div className="flex gap-1.5">
        <input
          id={inputId}
          type="text"
          aria-label={t("label")}
          placeholder={t("placeholder")}
          value={text}
          // Keep in step with ASK_MAX_LENGTH in lib/ask/query.ts (server-only module).
          maxLength={120}
          autoComplete="off"
          onChange={(e) => {
            setText(e.target.value);
            setNotice(null);
          }}
          className="bg-panel-glass min-h-9 min-w-0 flex-1 rounded-md border border-(--border) px-3 py-1.5 text-sm shadow backdrop-blur-[6px] placeholder:text-(--muted) focus:ring-2 focus:ring-(--accent) focus:outline-none"
        />
        <button
          type="submit"
          disabled={loading || text.trim() === ""}
          className="bg-panel-glass min-h-9 shrink-0 rounded-md border border-(--border) px-3 text-sm font-medium shadow backdrop-blur-[6px] hover:bg-(--panel-hover) focus:ring-2 focus:ring-(--accent) focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? t("loading") : t("submit")}
        </button>
      </div>
      <div aria-live="polite" className="absolute inset-x-0 top-full mt-1">
        {notice && (
          <div className="shadow-card rounded-md border border-(--border) bg-(--panel) px-3 py-2 text-sm backdrop-blur-[6px]">
            <p className="text-muted">{t(notice)}</p>
            {notice === "unsupported" && (
              <div className="mt-2">
                <p className="text-muted mb-1 text-xs">{t("examplesTitle")}</p>
                <ul className="flex flex-wrap gap-1.5">
                  {EXAMPLES.map((i) => (
                    <li key={i}>
                      <button
                        type="button"
                        onClick={() => {
                          const example = t(`examples.${i}`);
                          setText(example);
                          void ask(example);
                        }}
                        className="min-h-8 rounded-md border border-(--border) px-2.5 text-xs hover:bg-(--panel-hover) focus:ring-2 focus:ring-(--accent) focus:outline-none"
                      >
                        {t(`examples.${i}`)}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </form>
  );
}
