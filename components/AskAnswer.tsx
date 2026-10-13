"use client";

import { useLocale, useTranslations } from "next-intl";
import type {
  AnswerItem,
  AskAnswer,
  AskResult,
  SubbasinKind,
} from "@/lib/ask/contract";
import type { Filter } from "@/lib/ask/intent";
import { METRICS } from "@/lib/ask/metrics";
import type { SubbasinTreeNode } from "@/lib/data/queries";
import { useMapStore } from "@/lib/store";
import { useApi } from "@/lib/use-api";
import type { AskNotice } from "./use-ask";
import { Icon } from "./Icon";
import { type Caveat, Caveats, useFormat } from "./panel/parts";
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
  const filterLine = useFilterLine(answer);
  const caveats: Caveat[] = [
    ...(metric.caveat !== null && answer.items.some((i) => i.modeled)
      ? [metric.caveat]
      : []),
    ...answer.filterCaveats,
  ].filter((c, i, all) => all.indexOf(c) === i);
  const none = answer.total === 0;
  const regimeFilter = answer.filters.some((f) => f.type === "regime");

  return (
    <>
      <p>
        {none
          ? t("noneMatch", { kind: answer.kind })
          : (sentence ?? t("noData"))}
      </p>
      {filterLine && <p className="text-muted text-xs">{filterLine}</p>}
      {answer.total !== null && answer.total > 0 && (
        <p className="text-muted text-xs">
          {t("total", { total: answer.total })}
        </p>
      )}
      {!none && (
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
                <span className="min-w-0 flex-1 truncate">{name(item)}</span>
                {regimeFilter &&
                  item.nonPerennialPct != null &&
                  item.nonPerennialPct > 0 && (
                    <span className="text-muted text-xs tabular-nums">
                      {t("intermittentShare", {
                        pct: format("pct", item.nonPerennialPct),
                      })}
                    </span>
                  )}
                <span className="text-muted tabular-nums">
                  {item.value === null
                    ? t("noValue")
                    : format(metric.quantity, item.value)}
                </span>
                <button
                  type="button"
                  aria-label={t("openItem", { name: name(item) })}
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
      )}
      {!none && answer.provenance && (
        <p className="text-muted text-xs">
          {t("source", { provenance: answer.provenance })}
        </p>
      )}
      {caveats.length > 0 && <Caveats caveats={caveats} />}
    </>
  );
}

/**
 * Display name of a river or sub-basin of an answer; no name = the endorheic areas. A
 * sub-basin's kind comes with the answer (an "area" is labelled by its name).
 */
function useItemName(kind: AskAnswer["kind"]) {
  const subbasinLabel = useSubbasinLabel();
  return (item: {
    name: string | null;
    subbasinKind?: SubbasinKind;
  }): string =>
    kind === "subbasin"
      ? subbasinLabel({
          kind:
            item.subbasinKind ?? (item.name === null ? "endorheic" : "river"),
          name: item.name,
        })
      : (item.name ?? "—");
}

/** The sentence of the answer, or null when no item has a value. */
function useSentence(
  answer: AskAnswer,
  name: (item: { name: string | null; subbasinKind?: SubbasinKind }) => string,
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
      winners: list.format(winners.map((i) => name(i))),
      metric,
      value,
    });
  }

  const order = answer.order ?? "max";
  if (answer.type === "fact") {
    return t("answer.fact", { name: name(first), metric, value });
  }
  if (answer.type === "rank") {
    const direction = t("answer.direction", { order });
    const common = {
      kind: answer.kind,
      metric,
      direction,
      winner: name(first),
      value,
    };
    const adjectives = filterAdjectives(answer, t);
    if (answer.parent) {
      const parent = name(answer.parent);
      return adjectives
        ? t("answer.rank.tributariesFiltered", {
            ...common,
            parent,
            adjectives,
          })
        : t("answer.rank.tributaries", { ...common, parent });
    }
    if (!adjectives) return t("answer.rank.all", common);
    const text = t("answer.rank.allFiltered", { ...common, adjectives });
    // English puts the adjectives first, so the sentence no longer starts with a capital.
    return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
  }

  const others = answer.items.filter(
    (i) => i.id !== first.id && i.value !== null,
  );
  if (others.length === 0) {
    return t("answer.only", { winner: name(first), value });
  }
  return t("answer.compare", {
    winner: name(first),
    predicate: t("answer.predicate", {
      order,
      word: METRICS[answer.metric].word,
      kind: answer.kind,
      metric,
    }),
    value,
    others: list.format(others.map((i) => `${name(i)} (${show(i)})`)),
  });
}

type Translate = ReturnType<typeof useTranslations<"ask">>;

/** "perennial regulated": the filters that qualify the noun of a ranking sentence. */
function filterAdjectives(answer: AskAnswer, t: Translate): string {
  return answer.filters
    .flatMap((f) =>
      f.type === "regime"
        ? [t("filters.regime", { value: f.value })]
        : f.type === "regulated"
          ? [t("filters.regulated", { value: f.value, kind: answer.kind })]
          : [],
    )
    .join(" ");
}

/** The conditions of a ranking in one line, or null without filters. */
function useFilterLine(answer: AskAnswer): string | null {
  const t = useTranslations("ask");
  const format = useFormat();
  const hasWithin = answer.filters.some((f) => f.type === "within");
  // The answer carries the slug only; the sub-basin tree gives its name.
  const tree = useApi<SubbasinTreeNode[]>(hasWithin ? "/api/subbasins" : null);
  if (answer.filters.length === 0) return null;

  const part = (f: Filter): string => {
    switch (f.type) {
      case "regime":
        return t("filters.regime", { value: f.value });
      case "regulated":
        return t("filters.regulated", { value: f.value, kind: answer.kind });
      case "within": {
        const node =
          tree.status === "ok" ? tree.data.find((n) => n.id === f.slug) : null;
        if (!node) return t("filters.withinUnknown");
        return node.kind === "endorheic" || node.name === null
          ? t("filters.withinEndorheic")
          : node.kind === "area"
            ? t("filters.withinArea", { name: node.name })
            : t("filters.within", { name: node.name });
      }
      case "threshold":
        return t("filters.threshold", {
          metric: t(`metric.${f.metric}`),
          op: f.op,
          value: format(METRICS[f.metric].quantity, f.number),
        });
    }
  };
  return t("filters.label", { list: answer.filters.map(part).join(" · ") });
}
