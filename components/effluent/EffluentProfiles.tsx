"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import {
  ProfileChart,
  type ChartPoint,
} from "@/components/effluent/charts/ProfileChart";
import { useRegion, useRegionPath } from "@/components/RegionProvider";
import { useFormat } from "@/components/panel/parts";
import { profileEnvelope, profileOf } from "@/lib/effluent/profile";
import { getEffluentRegion } from "@/lib/effluent/registry";
import { useEffluentRun } from "@/lib/effluent/use-run";
import { useMapStore } from "@/lib/store";
import { MAP_PATH, REACH_PARAM, effluentSearch } from "@/lib/url-state";

const CARD = "bg-surface border-line-card rounded-[14px] border p-4";

/** DO and coliforms along the river for the shared run, with the coefficient range as a band. */
export function EffluentProfiles() {
  const t = useTranslations("effluents.profile");
  const locale = useLocale();
  const region = useRegion();
  const inRegion = useRegionPath();
  const router = useRouter();
  const f = useFormat();
  const effluent = useMapStore((s) => s.effluent);
  const run = useEffluentRun();

  const profile = useMemo(
    () => (run.status === "ok" ? profileOf(run.result) : null),
    [run],
  );
  // The 3×3 kd × Manning n grid is nine more simulations; memoized on the run.
  const envelope = useMemo(() => {
    const data = getEffluentRegion(region);
    if (run.status !== "ok" || !data) return null;
    try {
      const { effluent: e, params, scenario, thresholds } = run.inputs;
      return profileEnvelope(data.net, data.config, {
        effluent: e,
        params,
        scenario,
        thresholds,
      });
    } catch (error) {
      console.error(error);
      return null;
    }
  }, [run, region]);

  if (run.status !== "ok" || !profile) return null;
  const { result, inputs } = run;
  const { summary } = result;

  const num = (n: number, digits = 3) =>
    new Intl.NumberFormat(locale, { maximumSignificantDigits: digits }).format(
      n,
    );
  const mgL = (n: number) => t("mgL", { n: num(n) });
  const per100 = (n: number) => t("per100mL", { n: num(n) });
  const compact = (n: number) =>
    new Intl.NumberFormat(locale, { notation: "compact" }).format(n);

  const pick = (reachId: number) => {
    // Clear a reach already held from an earlier map visit, so UrlSync sees a change and fits.
    useMapStore.getState().select(null);
    const params = new URLSearchParams({ [REACH_PARAM]: String(reachId) });
    router.push(inRegion(MAP_PATH) + effluentSearch(params, effluent));
  };
  const pickLabel = (reachId: number, from: number, to: number) =>
    t("pick", { id: reachId, from: f("km", from), to: f("km", to) });

  const doPoints: ChartPoint[] = profile.map((p) => ({
    km: p.km,
    value: p.doMgL,
    reachId: p.reachId,
  }));
  const minDo = summary.minDo;
  const doPlume = summary.plume.do;
  const doThreshold = inputs.thresholds.doMinMgL;
  const doFinding =
    doPlume.km > 0
      ? t("doFinding", {
          min: mgL(minDo.mgL),
          km: f("km", minDo.km),
          threshold: mgL(doThreshold),
          length: f("km", doPlume.km),
        })
      : t("doFindingOk", {
          min: mgL(minDo.mgL),
          km: f("km", minDo.km),
          threshold: mgL(doThreshold),
        });

  const simulated = inputs.effluent.coliformsPer100mL !== null;
  const coliPoints: ChartPoint[] = profile.flatMap((p) =>
    p.coliformsPer100mL === null
      ? []
      : [{ km: p.km, value: p.coliformsPer100mL, reachId: p.reachId }],
  );
  const coliThreshold = inputs.thresholds.coliformsPer100mL;
  const coliPeak = summary.peak.coliforms;
  const coliPlume = summary.plume.coliforms;
  const coliFinding = !coliPeak
    ? null
    : coliPlume && coliPlume.km > 0 && coliThreshold !== null
      ? t("coliFinding", {
          peak: per100(coliPeak.value),
          km: f("km", coliPeak.km),
          threshold: per100(coliThreshold),
          length: f("km", coliPlume.km),
        })
      : coliThreshold !== null
        ? t("coliFindingOk", {
            peak: per100(coliPeak.value),
            km: f("km", coliPeak.km),
            threshold: per100(coliThreshold),
          })
        : t("coliFindingPeak", {
            peak: per100(coliPeak.value),
            km: f("km", coliPeak.km),
          });

  return (
    <>
      <section className={CARD} aria-labelledby="ef-do-title">
        <h2 id="ef-do-title" className="text-lg font-medium">
          {t("doTitle")}
        </h2>
        <p className="text-muted mb-3 text-sm">{doFinding}</p>
        <ProfileChart
          title={t("doTitle")}
          desc={t("doDesc", {
            min: mgL(minDo.mgL),
            km: f("km", minDo.km),
            total: f("km", summary.totalKm),
          })}
          points={doPoints}
          band={envelope?.do}
          bandLabel={t("band")}
          refs={[
            { value: doThreshold, label: t("doThreshold") },
            { value: result.doSaturationMgL, label: t("doSaturation") },
          ]}
          mark={{ km: minDo.km, value: minDo.mgL, label: t("minDo") }}
          yLabel={t("doAxis")}
          formatValue={mgL}
          formatTick={(v) => num(v, 2)}
          onPick={pick}
          pickLabel={pickLabel}
        />
      </section>
      <section className={CARD} aria-labelledby="ef-coli-title">
        <h2 id="ef-coli-title" className="text-lg font-medium">
          {t("coliTitle")}
        </h2>
        {simulated && coliPoints.length > 0 ? (
          <>
            {coliFinding && (
              <p className="text-muted mb-3 text-sm">{coliFinding}</p>
            )}
            <ProfileChart
              title={t("coliTitle")}
              desc={t("coliDesc", {
                total: f("km", summary.totalKm),
              })}
              points={coliPoints}
              band={envelope?.coliforms}
              bandLabel={t("band")}
              refs={
                coliThreshold === null
                  ? []
                  : [{ value: coliThreshold, label: t("coliThreshold") }]
              }
              yLabel={t("coliAxis")}
              yScale="log"
              formatValue={per100}
              formatTick={compact}
              onPick={pick}
              pickLabel={pickLabel}
            />
          </>
        ) : (
          <p className="text-muted text-sm">{t("coliOff")}</p>
        )}
      </section>
    </>
  );
}
