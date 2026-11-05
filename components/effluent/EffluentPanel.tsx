"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useRegion, useRegionPath } from "@/components/RegionProvider";
import { PanelFrame } from "@/components/panel/parts";
import { EffluentFailure } from "@/components/effluent/EffluentFailure";
import {
  EffluentInputs,
  OutfallSelect,
} from "@/components/effluent/EffluentInputs";
import { EffluentResults } from "@/components/effluent/EffluentResults";
import { effluentSources } from "@/lib/attributions";
import { getEffluentRegion } from "@/lib/effluent/registry";
import { useEffluentRun, useForecastDates } from "@/lib/effluent/use-run";
import { useMapStore } from "@/lib/store";
import { effluentSearch } from "@/lib/url-state";

/**
 * The panel of the discharge being simulated, in place of the info panel while effluent mode is
 * on: outfall, inputs, scenario, the run's results and its caveats.
 */
export function EffluentPanel() {
  const t = useTranslations("effluent");
  const region = useRegion();
  const reach = useMapStore((s) => s.effluent?.reach ?? null);
  const exitEffluent = useMapStore((s) => s.exitEffluent);
  const run = useEffluentRun();
  if (reach === null || !getEffluentRegion(region)) return null;

  return (
    <PanelFrame
      label={t("title")}
      busy={run.status === "loading"}
      onClose={exitEffluent}
    >
      <header className="flex flex-col gap-2 pr-8">
        <h2 className="font-display text-[26px] leading-tight font-normal">
          {t("title")}
        </h2>
        <OutfallSelect />
      </header>
      <EffluentInputs outfallPicker={false} />
      {run.status === "loading" && <p className="text-muted">{t("loading")}</p>}
      {run.status === "unavailable" && <EffluentFailure />}
      {run.status === "ok" && <EffluentResults />}
      <Notes />
    </PanelFrame>
  );
}

const LINK =
  "underline decoration-(--border) underline-offset-2 hover:decoration-current";

function Notes() {
  const t = useTranslations("effluent");
  const inRegion = useRegionPath();
  const reach = useMapStore((s) => s.effluent?.reach ?? null);
  const overrides = useMapStore((s) => s.effluent?.overrides);
  const dates = useForecastDates();
  if (reach === null || !overrides) return null;
  // The notice year is the forecast's, else the current UTC year.
  const year = dates?.[0]
    ? Number(dates[0].slice(0, 4))
    : new Date().getUTCFullYear();
  const sources = effluentSources(year);
  const openMeteo = sources.find((x) => x.id === "openmeteo");
  const glofas = sources.find((x) => x.id === "glofas");
  if (!openMeteo || !glofas) return null;
  const href =
    inRegion("/effluents") +
    effluentSearch(new URLSearchParams(), { reach, overrides });
  return (
    <footer className="text-muted flex flex-col gap-2 border-t border-(--border) pt-3 text-xs">
      <Link
        href={href}
        className="text-text min-h-10 w-fit py-2 text-sm underline"
      >
        {t("fullAnalysis")}
      </Link>
      <p>{t("caveat")}</p>
      <p>{t("mapCoverage")}</p>
      <p>
        {t("attribution.prefix")}{" "}
        <a href={openMeteo.url} className={LINK}>
          {openMeteo.credit}
        </a>{" "}
        (
        <a href={openMeteo.license.url} className={LINK}>
          {openMeteo.license.name}
        </a>
        ). {t("attribution.modified")} {glofas.credit}.
      </p>
    </footer>
  );
}
