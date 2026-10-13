"use client";

import { useLocale } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AskResult } from "@/lib/ask/contract";
import { useMapStore } from "@/lib/store";
import { useRegionPath } from "./RegionProvider";

export type AskNotice = "noMatch" | "unsupported" | "rateLimited" | "error";

/**
 * Posts a question to /api/ask. A "select" result opens that river, sub-basin or stream
 * on the map; an "answer" result is only kept for the answer card under the bar (owner,
 * 2026-10-10: a question does not open the side panel; the card's Open buttons do). `ask`
 * resolves to true when the question was answered by opening something ("select").
 */
export function useAsk() {
  const locale = useLocale();
  const inRegion = useRegionPath();
  const select = useMapStore((s) => s.select);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AskResult | null>(null);
  const [notice, setNotice] = useState<AskNotice | null>(null);
  const controller = useRef<AbortController | null>(null);

  // Drop an in-flight request when the bar goes away.
  useEffect(() => () => controller.current?.abort(), []);

  const clear = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    setLoading(false);
    setResult(null);
    setNotice(null);
  }, []);

  const ask = useCallback(
    async (question: string): Promise<boolean> => {
      const q = question.trim();
      if (!q) return false;
      controller.current?.abort();
      const mine = new AbortController();
      controller.current = mine;
      setLoading(true);
      setResult(null);
      setNotice(null);
      try {
        const res = await fetch(inRegion("/api/ask"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ q, locale }),
          signal: mine.signal,
        });
        if (mine.signal.aborted) return false;
        if (res.status === 429) {
          setNotice("rateLimited");
          return false;
        }
        if (!res.ok) {
          setNotice("error");
          return false;
        }
        const body = (await res.json()) as AskResult;
        if (mine.signal.aborted) return false;
        if (body.action === "select") {
          select({ kind: body.kind, id: body.id }, { fit: true });
          return true;
        } else if (body.action === "answer") {
          setResult(body);
        } else {
          setNotice(body.action === "no_match" ? "noMatch" : "unsupported");
        }
        return false;
      } catch {
        // A superseded or unmounted request aborts; only a real failure shows a message.
        if (!mine.signal.aborted) setNotice("error");
        return false;
      } finally {
        if (controller.current === mine) {
          controller.current = null;
          setLoading(false);
        }
      }
    },
    [locale, select, inRegion],
  );

  return { ask, loading, result, notice, clear };
}
