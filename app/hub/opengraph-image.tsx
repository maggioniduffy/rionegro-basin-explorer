import { ImageResponse } from "next/og";
import { messagesFor } from "@/i18n/messages";
import { OG_SIZE } from "@/lib/og";
import {
  OG_COLORS,
  OG_FONTS,
  OgBasin,
  OgEyebrow,
  OgFrame,
} from "@/lib/og-image";
import { DEFAULT_REGION, REGION_IDS } from "@/regions";
import { REGION_BRANDS } from "@/regions/brand";
import { OG_SHAPES } from "@/regions/generated";

// The hub's strings are shared, so any region's messages give them; like the regions'
// image, one static card shows both languages.
const en = messagesFor(DEFAULT_REGION, "en").hub;
const es = messagesFor(DEFAULT_REGION, "es").hub;

export const alt = `${en.metadata.title} · ${es.metadata.title}`;
export const size = OG_SIZE;
export const contentType = "image/png";

/** Width of each served region's basin on the right. */
const BASIN_WIDTH = 230;

/** The hub's headline beside every served region's basin (REGION_IDS). */
export default async function Image() {
  return new ImageResponse(
    <OgFrame brand={en.metadata.title}>
      <div
        style={{
          position: "absolute",
          left: 72,
          top: 150,
          bottom: 64,
          width: 560,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <OgEyebrow>{en.eyebrow}</OgEyebrow>
        <div
          style={{
            marginTop: 26,
            fontFamily: "Instrument Serif",
            fontSize: 76,
            lineHeight: 1,
            letterSpacing: -1.5,
          }}
        >
          {en.h1}
        </div>
        <div
          style={{
            marginTop: 18,
            fontFamily: "Instrument Serif",
            fontSize: 34,
            lineHeight: 1.15,
            color: OG_COLORS.secondary,
          }}
        >
          {es.h1}
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          right: 64,
          top: 0,
          bottom: 0,
          display: "flex",
          alignItems: "center",
          gap: 28,
        }}
      >
        {REGION_IDS.map((id) => (
          <div
            key={id}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 14,
            }}
          >
            <OgBasin shapes={OG_SHAPES[id]} width={BASIN_WIDTH} />
            <div
              style={{
                fontFamily: "JetBrains Mono",
                fontSize: 14,
                color: OG_COLORS.accentSoft,
              }}
            >
              {REGION_BRANDS[id]}
            </div>
          </div>
        ))}
      </div>
    </OgFrame>,
    { ...size, fonts: OG_FONTS },
  );
}
