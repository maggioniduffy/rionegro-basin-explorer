"use client";

import { useTranslations } from "next-intl";
import type { SubbasinResponse } from "@/lib/data/queries";
import { useMapStore } from "@/lib/store";
import type { Selection } from "@/lib/url-state";
import { type Caveat, Caveats, Group, Row, useFormat } from "./parts";
import { useSubbasinLabel } from "./subbasin-label";
import { Icon } from "../Icon";

/** Modeled value path (Subbasin.modeled) → the caveat that explains it. */
const CAVEAT_BY_PATH: [string, Caveat][] = [
  ["outlet.dischargeM3s", "discharge"],
  ["nonPerennialPct", "nonPerennial"],
  ["floodedMaxPct", "flooded"],
  ["population", "population"],
  ["outlet.regulationPct", "regulation"],
];

function LinkButton({
  to,
  children,
}: {
  to: Selection;
  children: React.ReactNode;
}) {
  const select = useMapStore((s) => s.select);
  return (
    <button
      type="button"
      className="underline decoration-dotted underline-offset-2 hover:text-(--foreground)"
      onClick={() => select(to, { fit: true })}
    >
      {children}
    </button>
  );
}

export function SubbasinPanel({ subbasin: b }: { subbasin: SubbasinResponse }) {
  const t = useTranslations("panel");
  const f = useFormat();
  const label = useSubbasinLabel();
  const isRoot = b.parentId === null;
  const modeled = (path: string) => b.modeled.includes(path);
  const isolatedIds = useMapStore((s) => s.isolatedIds);
  const setIsolatedIds = useMapStore((s) => s.setIsolatedIds);
  const isolated = isolatedIds !== null;
  const caveats = CAVEAT_BY_PATH.filter(([path]) => modeled(path)).map(
    ([, c]) => c,
  );

  return (
    <>
      <header className="flex flex-col gap-1 pr-8">
        <h2 className="text-lg leading-tight font-semibold">{label(b)}</h2>
        {b.ancestors.length > 0 ? (
          <nav aria-label={t("subbasin.breadcrumb")}>
            <ol className="text-muted flex flex-wrap items-center gap-x-1 text-sm">
              {b.ancestors.map((a) => (
                <li key={a.id} className="flex items-center gap-1">
                  <LinkButton to={{ kind: "subbasin", id: a.id }}>
                    {a.name ?? label(a)}
                  </LinkButton>
                  <span aria-hidden>›</span>
                </li>
              ))}
              <li aria-current="location">{b.name ?? label(b)}</li>
            </ol>
          </nav>
        ) : (
          <p className="text-muted text-sm">{t("subbasin.wholeBasin")}</p>
        )}
        {b.kind === "endorheic" && (
          <p className="text-xs text-amber-300">
            {t("subbasin.endorheicNote")}
          </p>
        )}
        {b.children.length > 0 && (
          <p className="text-muted text-sm">
            {t("subbasin.children")}{" "}
            {b.children.map((c, i) => (
              <span key={c.id}>
                {i > 0 && ", "}
                <LinkButton to={{ kind: "subbasin", id: c.id }}>
                  {label(c)}
                </LinkButton>
              </span>
            ))}
          </p>
        )}
        {/* The whole basin has nothing else to hide. */}
        {!isRoot && (
          <button
            type="button"
            aria-pressed={isolated}
            onClick={() =>
              // The map isolates the whole subtree (lib/map/style.ts inSubtrees).
              setIsolatedIds(isolated ? null : [b._id])
            }
            className="mt-1 flex items-center gap-2 self-start rounded-md border border-(--border) px-2.5 py-1 hover:bg-(--panel-hover)"
          >
            <Icon name="mask" />
            {isolated ? t("subbasin.showOthers") : t("subbasin.hideOthers")}
          </button>
        )}
      </header>

      <Group
        title={t("groups.land")}
        hint={
          b.kind === "endorheic"
            ? undefined
            : isRoot
              ? t("groups.landHintWhole")
              : t("groups.landHintRiver", { river: b.name ?? "" })
        }
      >
        <Row label={t("fields.area")}>{f("km2", b.areaKm2)}</Row>
        {/* Only the whole basin mixes river and endorheic land. */}
        {b.kind === "river" && b.endorheicAreaKm2 > 0 && (
          <Row label={t("fields.endorheicArea")}>
            {f("km2", b.endorheicAreaKm2)}
          </Row>
        )}
        <Row label={t("fields.elevationRange")}>
          {t("fields.rangeValue", {
            min: f("m", b.elevationMinM),
            max: f("m", b.elevationMaxM),
          })}
        </Row>
        <Row label={t("fields.flooded")} modeled={modeled("floodedMaxPct")}>
          {t("fields.floodedValue", {
            min: f("pct", b.floodedMinPct),
            max: f("pct", b.floodedMaxPct),
          })}
        </Row>
        <Row label={t("fields.lakes")}>{f("pct", b.lakesPct)}</Row>
        <Row label={t("fields.population")} modeled={modeled("population")}>
          {f("count", b.population)}
        </Row>
      </Group>

      <Group title={t("groups.streams")}>
        <Row label={t("fields.streamLength")}>{f("km", b.lengthKm)}</Row>
        {b.kind === "river" && b.endorheicLengthKm > 0 && (
          <Row label={t("fields.endorheicLength")}>
            {f("km", b.endorheicLengthKm)}
          </Row>
        )}
        <Row label={t("fields.reachCount")}>{f("count", b.reachCount)}</Row>
        <Row
          label={t("fields.nonPerennial")}
          modeled={modeled("nonPerennialPct")}
        >
          {f("pct", b.nonPerennialPct)}
          {b.unknownPct > 0 && (
            <span className="text-muted block text-xs font-normal">
              {t("fields.noPrediction", { pct: f("pct", b.unknownPct) })}
            </span>
          )}
        </Row>
      </Group>

      {b.outlet && (
        <Group
          title={t("groups.outlet")}
          hint={t("groups.outletHint", { river: b.name ?? "" })}
        >
          <Row
            label={t("fields.discharge")}
            modeled={modeled("outlet.dischargeM3s")}
          >
            {f("m3s", b.outlet.dischargeM3s)}
          </Row>
          <Row
            label={t("fields.regulation")}
            modeled={modeled("outlet.regulationPct")}
          >
            {f("pct", b.outlet.regulationPct)}
          </Row>
        </Group>
      )}

      {b.riverRefs.length > 0 && (
        // Not a Group: a list of links, not a <dl> of values.
        <section className="flex flex-col gap-0.5">
          <h3 className="text-muted text-xs font-medium tracking-wide uppercase">
            {t("groups.rivers")}
          </h3>
          <ul className="flex flex-wrap gap-x-3 gap-y-1 pt-1">
            {b.riverRefs.map((r) => (
              <li key={r.id}>
                <LinkButton to={{ kind: "river", id: r.id }}>
                  {r.name}
                </LinkButton>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Caveats caveats={caveats} />
    </>
  );
}
