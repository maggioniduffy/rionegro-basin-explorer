import { useTranslations } from "next-intl";
import { hasEffluent } from "@/lib/effluent/overlay";
import { useRegion } from "@/components/RegionProvider";
import { hasCourseFill } from "@/lib/map/config";
import {
  FILL_DASH,
  FLOW_CLASSES,
  FLOW_STYLE,
  RIVER_COLORS,
} from "@/lib/map/style";
import { useMapStore } from "@/lib/store";
import { EFFLUENT_COLORS } from "@/lib/theme-tokens";

/** Line swatch drawn like the map layer: solid, dashed, or thin. */
export function Swatch({
  color,
  dash,
  widthScale,
}: (typeof FLOW_STYLE)["unknown"] & { color: string }) {
  const width = 3 * widthScale;
  return (
    <svg width="28" height="8" aria-hidden className="shrink-0">
      <line
        x1="1"
        y1="4"
        x2="27"
        y2="4"
        stroke={color}
        strokeWidth={width}
        strokeLinecap={dash ? "butt" : "round"}
        strokeDasharray={
          dash ? `${dash[0] * width} ${dash[1] * width}` : undefined
        }
      />
    </svg>
  );
}

/** The effluent block, shown while the mode is on: outfall marker and the plume's two classes. */
function EffluentLegend() {
  const t = useTranslations("effluent.legend");
  const colors = EFFLUENT_COLORS[useMapStore((s) => s.theme)];
  return (
    <div className="flex flex-col gap-1.5">
      <h2 className="font-medium">{t("title")}</h2>
      <ul className="flex flex-col gap-1">
        <li className="flex items-center gap-2">
          <svg width="28" height="14" aria-hidden className="shrink-0">
            <circle
              cx="14"
              cy="7"
              r="5"
              fill={colors.outfall}
              stroke={colors.exceeds}
              strokeWidth="2"
            />
          </svg>
          <span>{t("outfall")}</span>
        </li>
        <li className="flex items-center gap-2">
          <Swatch color={colors.exceeds} widthScale={1} />
          <span>{t("exceeds")}</span>
        </li>
        <li className="flex items-center gap-2">
          <Swatch color={colors.within} widthScale={1} />
          <span>{t("within")}</span>
        </li>
      </ul>
      <p className="text-muted text-xs">{t("note")}</p>
    </div>
  );
}

export function Legend() {
  const t = useTranslations("legend");
  const colors = RIVER_COLORS[useMapStore((s) => s.baseLayer)];
  const region = useRegion();
  const courseFill = hasCourseFill(region);
  const effluentOn = useMapStore((s) => s.effluent !== null);

  return (
    <>
      {effluentOn && hasEffluent(region) && <EffluentLegend />}
      <div className="flex flex-col gap-1.5">
        <h2 className="font-medium">{t("title")}</h2>
        <ul className="flex flex-col gap-1">
          {FLOW_CLASSES.map((c) => (
            <li key={c} className="flex items-center gap-2">
              <Swatch {...FLOW_STYLE[c]} color={colors[c]} />
              <span>{t(c)}</span>
            </li>
          ))}
          <li className="flex items-center gap-2">
            <Swatch color={colors.detail} widthScale={0.6} />
            <span>{t("ignDetail")}</span>
          </li>
          {courseFill && (
            <li className="flex items-center gap-2">
              <Swatch
                color={colors.unknown}
                dash={FILL_DASH}
                widthScale={FLOW_STYLE.unknown.widthScale}
              />
              <span>{t("fill")}</span>
            </li>
          )}
        </ul>
        {courseFill && <p className="text-muted text-xs">{t("lengthNote")}</p>}
        <p className="text-muted text-xs">{t("modeledNote")}</p>
      </div>
    </>
  );
}
