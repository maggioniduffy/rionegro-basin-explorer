"use client";

import { useTranslations } from "next-intl";
import { useEffluentRun } from "@/lib/effluent/use-run";
import { useMapStore } from "@/lib/store";

/** Why the run is unavailable, worded per reason; null when it is not. */
export function EffluentFailure() {
  const t = useTranslations("effluent");
  const run = useEffluentRun();
  const set = useMapStore((s) => s.setEffluentOverrides);
  if (run.status !== "unavailable") return null;
  if (run.reason === "forecast")
    return (
      <div className="flex flex-col items-start gap-2" role="alert">
        <p className="text-warning">{t("failure.forecast")}</p>
        <button
          type="button"
          onClick={() => set({ scenario: undefined })}
          className="border-line min-h-10 rounded-md border px-3 text-sm"
        >
          {t("failure.useMean")}
        </button>
      </div>
    );
  if (run.reason === "inputs")
    return (
      <p className="text-warning" role="alert">
        {run.field
          ? t("failure.inputsField", { field: t(`fields.${run.field}`) })
          : t("failure.inputs")}
      </p>
    );
  return (
    <p className="text-warning" role="alert">
      {t(run.reason === "outsideNet" ? "failure.outsideNet" : "failure.config")}
    </p>
  );
}
