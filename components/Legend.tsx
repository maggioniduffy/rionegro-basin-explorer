import { useTranslations } from "next-intl";
import { useMapStore } from "@/lib/store";
import { FLOW_CLASSES, FLOW_STYLE, IGN_DETAIL_COLOR } from "@/lib/map/style";

/** Line swatch drawn like the map layer: solid, dashed, or thin. */
function Swatch({ color, dash, widthScale }: (typeof FLOW_STYLE)["unknown"]) {
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

export function Legend() {
  const t = useTranslations("legend");
  const showIgnDetail = useMapStore((s) => s.showIgnDetail);

  return (
    <div className="flex flex-col gap-1.5">
      <h2 className="font-medium">{t("title")}</h2>
      <ul className="flex flex-col gap-1">
        {FLOW_CLASSES.map((c) => (
          <li key={c} className="flex items-center gap-2">
            <Swatch {...FLOW_STYLE[c]} />
            <span>{t(c)}</span>
          </li>
        ))}
        {showIgnDetail && (
          <li className="flex items-center gap-2">
            <Swatch color={IGN_DETAIL_COLOR} widthScale={0.6} />
            <span>{t("ignDetail")}</span>
          </li>
        )}
      </ul>
      <p className="text-muted text-xs">{t("modeledNote")}</p>
    </div>
  );
}
