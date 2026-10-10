"use client";

import { useLocale, useTranslations } from "next-intl";
import type { AnswerItem, AskAnswer, AskResult } from "@/lib/ask/contract";
import { METRICS } from "@/lib/ask/metrics";
import { useMapStore } from "@/lib/store";
import type { AskNotice } from "./use-ask";
import { Icon } from "./Icon";
import { Caveats, useFormat } from "./panel/parts";
import { useSubbasinLabel } from "./panel/subbasin-label";

/** Keep in step with messages ask.examples: the first two need the LLM, the third doesn't. */
const EXAMPLES = ["0", "1", "2"] as const;

interface Props {
  loading: boolean;
  result: AskResult | null;
  notice: AskNotice | null;
  onClose: () => void;
  /** Submit one of the example questions. */
  onAsk: (question: string) => void;
}

/**
 * The card under the search bar: the answer to a question (a sentence from the i18n
 * templates, the compared items with their values, the source and the modeled-data
 * caveat), or the notice when the question could not be answered. Values come from the
 * server; the sentence only arranges them.
 */
export function AskAnswerCard({
  loading,
  result,
  notice,
  onClose,
  onAsk,
}: Props) {
  const t = useTranslations("ask");
  const answer = result?.action === "answer" ? result.answer : null;
  const visible = loading || notice !== null || answer !== null;

  return (
    <div aria-live="polite" className="absolute inset-x-0 top-full mt-1">
      {visible && (
        <section
          aria-label={t("label")}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              // Handled here: the info panel ignores an Escape that closed the card.
              e.preventDefault();
              onClose();
            }
          }}
          className="shadow-card relative flex max-h-[min(24rem,60dvh)] flex-col gap-2 overflow-y-auto rounded-md border border-(--border) bg-(--panel) py-2.5 pr-9 pl-3 text-sm backdrop-blur-[6px]"
        >
          {!loading && (
            <button
              type="button"
              aria-label={t("close")}
              title={t("close")}
              onClick={onClose}
              className="text-muted absolute top-1.5 right-1.5 inline-flex size-7 items-center justify-center rounded-md hover:bg-(--panel-hover) focus:ring-2 focus:ring-(--accent) focus:outline-none"
            >
              <Icon name="close" size={16} />
            </button>
          )}
          {loading ? (
            <p className="text-muted">{t("loading")}</p>
          ) : answer ? (
            <AnswerBody answer={answer} />
          ) : notice ? (
            <>
              <p className="text-muted">{t(notice)}</p>
              {notice === "unsupported" && (
                <div>
                  <p className="text-muted mb-1 text-xs">
                    {t("examplesTitle")}
                  </p>
                  <ul className="flex flex-wrap gap-1.5">
                    {EXAMPLES.map((i) => (
                      <li key={i}>
                        <button
                          type="button"
                          onClick={() => onAsk(t(`examples.${i}`))}
                          className="min-h-8 rounded-md border border-(--border) px-2.5 text-left text-xs hover:bg-(--panel-hover) focus:ring-2 focus:ring-(--accent) focus:outline-none"
                        >
                          {t(`examples.${i}`)}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : null}
        </section>
      )}
    </div>
  );
}

function AnswerBody({ answer }: { answer: AskAnswer }) {
  const t = useTranslations("ask");
  const select = useMapStore((s) => s.select);
  const format = useFormat();
  const metric = METRICS[answer.metric];
  const name = useItemName(answer.kind);
  const sentence = useSentence(answer, name);
  const caveat =
    metric.caveat !== null && answer.items.some((i) => i.modeled)
      ? metric.caveat
      : null;

  return (
    <>
      <p>{sentence ?? t("noData")}</p>
      <div>
        <p className="text-muted mb-1 text-xs first-letter:uppercase">
          {t(`metric.${answer.metric}`)}
        </p>
        <ul className="divide-line-faint divide-y">
          {answer.items.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between gap-2 py-1"
            >
              <span className="min-w-0 flex-1 truncate">{name(item.name)}</span>
              <span className="text-muted tabular-nums">
                {item.value === null
                  ? t("noValue")
                  : format(metric.quantity, item.value)}
              </span>
              <button
                type="button"
                aria-label={t("openItem", { name: name(item.name) })}
                onClick={() =>
                  select({ kind: answer.kind, id: item.id }, { fit: true })
                }
                className="min-h-8 shrink-0 rounded-md border border-(--border) px-2.5 text-xs hover:bg-(--panel-hover) focus:ring-2 focus:ring-(--accent) focus:outline-none"
              >
                {t("open")}
              </button>
            </li>
          ))}
        </ul>
      </div>
      {answer.provenance && (
        <p className="text-muted text-xs">
          {t("source", { provenance: answer.provenance })}
        </p>
      )}
      {caveat && <Caveats caveats={[caveat]} />}
    </>
  );
}

/** Display name of a river or sub-basin of an answer; no name = the endorheic areas. */
function useItemName(kind: AskAnswer["kind"]) {
  const subbasinLabel = useSubbasinLabel();
  return (name: string | null): string =>
    kind === "subbasin"
      ? subbasinLabel({ kind: name === null ? "endorheic" : "river", name })
      : (name ?? "—");
}

/** The sentence of the answer, or null when no item has a value. */
function useSentence(
  answer: AskAnswer,
  name: (n: string | null) => string,
): string | null {
  const t = useTranslations("ask");
  const locale = useLocale();
  const format = useFormat();
  const { quantity } = METRICS[answer.metric];
  const list = new Intl.ListFormat(locale, {
    style: "long",
    type: "conjunction",
  });
  const metric = t(`metric.${answer.metric}`);
  const show = (item: AnswerItem) =>
    item.value === null ? t("noValue") : format(quantity, item.value);

  const winners = answer.winnerIds
    .map((id) => answer.items.find((i) => i.id === id))
    .filter((i): i is AnswerItem => i !== undefined && i.value !== null);
  const first = winners[0];
  if (!first) return null;
  const value = show(first);

  if (winners.length > 1) {
    return t("answer.tie", {
      winners: list.format(winners.map((i) => name(i.name))),
      metric,
      value,
    });
  }

  const order = answer.order ?? "max";
  if (answer.type === "fact") {
    return t("answer.fact", { name: name(first.name), metric, value });
  }
  if (answer.type === "rank") {
    const direction = t("answer.direction", { order });
    return answer.parent
      ? t("answer.rank.tributaries", {
          parent: name(answer.parent.name),
          kind: answer.kind,
          metric,
          direction,
          winner: name(first.name),
          value,
        })
      : t("answer.rank.all", {
          kind: answer.kind,
          metric,
          direction,
          winner: name(first.name),
          value,
        });
  }

  const others = answer.items.filter(
    (i) => i.id !== first.id && i.value !== null,
  );
  if (others.length === 0) {
    return t("answer.only", { winner: name(first.name), value });
  }
  return t("answer.compare", {
    winner: name(first.name),
    predicate: t("answer.predicate", {
      order,
      word: METRICS[answer.metric].word,
      kind: answer.kind,
      metric,
    }),
    value,
    others: list.format(others.map((i) => `${name(i.name)} (${show(i)})`)),
  });
}
