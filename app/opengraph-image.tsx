import { ImageResponse } from "next/og";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import { OG_MAP_BOX, OG_SIZE } from "@/lib/og";
import { FLOW_STYLE, THEME_COLORS } from "@/lib/map/style";
import shapes from "./og-shapes.json";

// One static image for both languages: a shared link has no locale cookie, so the
// card shows both titles (the site picks its language per visitor).
export const alt = `${en.metadata.title} · ${es.metadata.title}`;
export const size = OG_SIZE;
export const contentType = "image/png";

const { mask, lake } = THEME_COLORS.dark;

/** Basin, lakes and Strahler ≥ 4 rivers from rivers.pmtiles (scripts/og-shapes.ts). */
export default function Image() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        background: mask,
        color: "#f4f4f5",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          width: OG_MAP_BOX.left,
          padding: "0 40px 0 72px",
        }}
      >
        <div style={{ fontSize: 64, lineHeight: 1.1, letterSpacing: -1 }}>
          {en.metadata.title}
        </div>
        <div style={{ fontSize: 30, marginTop: 16, color: "#a1a1aa" }}>
          {es.metadata.title}
        </div>
        <div
          style={{
            fontSize: 26,
            marginTop: 40,
            color: FLOW_STYLE.perennial.color,
          }}
        >
          Limay · Neuquén · Río Negro
        </div>
      </div>
      <svg
        width={OG_MAP_BOX.width}
        height={OG_MAP_BOX.height}
        viewBox={`0 0 ${OG_MAP_BOX.width} ${OG_MAP_BOX.height}`}
        style={{
          position: "absolute",
          left: OG_MAP_BOX.left,
          top: OG_MAP_BOX.top,
        }}
      >
        <path d={shapes.basin} fill="#1a1e22" />
        <path d={shapes.lakes} fill={lake} />
        {shapes.rivers.map((r) => (
          <path
            key={r.strahler}
            d={r.d}
            fill="none"
            stroke={FLOW_STYLE.perennial.color}
            strokeWidth={Math.max(0.6, (r.strahler - 3) * 0.7)}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </svg>
    </div>,
    size,
  );
}
