"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { EffluentFailure } from "@/components/effluent/EffluentFailure";
import { EffluentProfiles } from "@/components/effluent/EffluentProfiles";
import { EffluentAssumptions } from "@/components/effluent/EffluentAssumptions";
import { EffluentModelSettings } from "@/components/effluent/EffluentModelSettings";
import { EffluentInputs } from "@/components/effluent/EffluentInputs";
import { EffluentFacts } from "@/components/effluent/EffluentFacts";
import { EffluentFlowChart } from "@/components/effluent/EffluentFlowChart";
import { EffluentScenarios } from "@/components/effluent/EffluentScenarios";
import { EffluentRunProvider } from "@/components/effluent/EffluentRunProvider";
import { EffluentUrlSync } from "@/components/effluent/EffluentUrlSync";
import { Icon } from "@/components/Icon";
import { useRegion, useRegionPath } from "@/components/RegionProvider";
import { getEffluentRegion } from "@/lib/effluent/registry";
import { useEffluentRun, useForecast } from "@/lib/effluent/use-run";
import { useMapStore } from "@/lib/store";
import { MAP_PATH, effluentSearch } from "@/lib/url-state";

const CARD = "bg-surface border-line-card rounded-[14px] border p-4";

/** The analysis page's body: one run shared by the inputs and the results, ?ef= kept in the URL. */
export function EffluentAnalysis() {
  return (
    <EffluentRunProvider>
      <EffluentUrlSync />
      <Body />
    </EffluentRunProvider>
  );
}

function Body() {
  const t = useTranslations("effluents");
  const run = useEffluentRun();
  const effluent = useMapStore((s) => s.effluent);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 sm:py-12">
      <Header />
      {effluent && (
        <div className="grid items-start gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="flex min-w-0 flex-col gap-4">
            <div className={CARD}>
              <EffluentInputs />
            </div>
            <EffluentModelSettings />
          </aside>
          <div className="flex min-w-0 flex-col gap-4">
            <section className={CARD} aria-busy={run.status === "loading"}>
              {run.status === "loading" && (
                <p className="text-muted">{t("loading")}</p>
              )}
              {run.status === "unavailable" && <EffluentFailure />}
              {run.status === "ok" && <EffluentFacts />}
            </section>
            <EffluentProfiles />
            <EffluentScenarios />
            <EffluentFlowChart />
            <EffluentAssumptions />
          </div>
        </div>
      )}
    </main>
  );
}

function Header() {
  const t = useTranslations("effluents");
  const te = useTranslations("effluent");
  const locale = useLocale();
  const region = useRegion();
  const inRegion = useRegionPath();
  const effluent = useMapStore((s) => s.effluent);
  const forecast = useForecast();
  const outfalls = getEffluentRegion(region)?.config.outfalls ?? [];
  const reach = effluent?.reach ?? null;
  const name =
    reach === null
      ? null
      : (outfalls.find((o) => o.reach === reach)?.name ??
        te("customReach", { id: reach }));
  const back =
    inRegion(MAP_PATH) +
    (effluent ? effluentSearch(new URLSearchParams(), effluent) : "");
  const fetched = forecast
    ? new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      }).format(new Date(forecast.fetchedAt))
    : null;

  return (
    <header className="flex flex-col gap-3">
      <Link
        href={back}
        className="text-muted hover:text-foreground flex min-h-10 w-fit items-center gap-1.5 text-sm"
      >
        <Icon name="chevron" size={16} className="rotate-180" />
        {t("back")}
      </Link>
      <h1 className="text-[clamp(28px,4vw,44px)] font-medium tracking-[-0.025em]">
        {t("title")}
      </h1>
      {name && <p className="text-secondary text-lg">{name}</p>}
      {fetched && (
        <p className="text-muted font-mono text-xs tabular-nums">
          {t("forecastStamp", { date: fetched })}
        </p>
      )}
    </header>
  );
}
