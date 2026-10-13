import { ImageResponse } from "next/og";
import { messagesFor } from "@/i18n/messages";
import { OG_MAP_BOX, OG_SIZE } from "@/lib/og";
import { FLOW_STYLE, THEME_COLORS } from "@/lib/map/style";
import { DEFAULT_REGION, isRegionId, REGION_IDS } from "@/regions";
import { REGION_CONTENT } from "@/regions/content";
import { OG_SHAPES } from "@/regions/generated";

// One static image for both languages: a shared link has no locale cookie, so the
// card shows both titles (the site picks its language per visitor). The alt text names the
// region, so it comes from generateImageMetadata (one image per region, id "og").
export function generateImageMetadata({
  params,
}: {
  params: { region: string };
}) {
  const region = isRegionId(params.region) ? params.region : DEFAULT_REGION;
  return [
    {
      id: "og",
      alt: `${messagesFor(region, "en").metadata.title} · ${messagesFor(region, "es").metadata.title}`,
      size: OG_SIZE,
      contentType: "image/png",
    },
  ];
}

const size = OG_SIZE;

// Rendered at build time, one per region.
export function generateStaticParams() {
  return REGION_IDS.map((region) => ({ region }));
}

const { mask, lake } = THEME_COLORS.dark;

/** Basin, lakes and Strahler ≥ 4 rivers from rivers.pmtiles (scripts/og-shapes.ts). */
export default async function Image({
  params,
}: {
  params: Promise<{ region: string }>;
  id: Promise<string>;
}) {
  const { region: raw } = await params;
  const region = isRegionId(raw) ? raw : DEFAULT_REGION;
  const en = messagesFor(region, "en");
  const es = messagesFor(region, "es");
  const shapes = OG_SHAPES[region];
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
          {REGION_CONTENT[region].ogSubtitle}
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
