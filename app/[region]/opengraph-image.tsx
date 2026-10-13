import { ImageResponse } from "next/og";
import { messagesFor } from "@/i18n/messages";
import { OG_MAP_BOX, OG_SIZE } from "@/lib/og";
import {
  OG_COLORS,
  OG_FONTS,
  OgBasin,
  OgEyebrow,
  OgFrame,
} from "@/lib/og-image";
import { notFound } from "next/navigation";
import {
  DEFAULT_REGION,
  REGION_IDS,
  REGION_SLUGS,
  regionFromSlug,
} from "@/regions";
import { REGION_BRANDS } from "@/regions/brand";
import { REGION_CONTENT } from "@/regions/content";
import { OG_SHAPES } from "@/regions/generated";

// One static image for both languages: a shared link has no locale cookie, so the
// card shows the landing's headline in both (the site picks its language per visitor).
// `alt` is a constant export shared by every region, so it names the product family (the
// hub's title, shared messages); the image itself shows the region's titles. A per-region alt
// via generateImageMetadata answered 404 for every image in this Next version (R3.8).
export const alt = `${messagesFor(DEFAULT_REGION, "en").hub.metadata.title} · ${messagesFor(DEFAULT_REGION, "es").hub.metadata.title}`;
export const size = OG_SIZE;
export const contentType = "image/png";

/** Headlines longer than this (cba's) get a smaller size, so they stay on three lines. */
const LONG_HEADLINE = 55;

// Rendered at build time, one per region (regions/<id>/og-shapes.json).
export function generateStaticParams() {
  return REGION_IDS.map((id) => ({ region: REGION_SLUGS[id] }));
}

/** The landing's hero (Landing v6) beside the basin, its lakes and main rivers. */
export default async function Image({
  params,
}: {
  params: Promise<{ region: string }>;
}) {
  const region = regionFromSlug((await params).region);
  if (!region) notFound();
  const en = messagesFor(region, "en").landing;
  const es = messagesFor(region, "es").landing;
  const names = REGION_CONTENT[region].ogSubtitle.split(" · ");
  return new ImageResponse(
    <OgFrame brand={REGION_BRANDS[region]}>
      <div
        style={{
          position: "absolute",
          left: 72,
          top: 150,
          bottom: 64,
          width: OG_MAP_BOX.left - 72,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <OgEyebrow>{en.eyebrow}</OgEyebrow>
        <div
          style={{
            marginTop: 26,
            fontFamily: "Instrument Serif",
            fontSize: en.h1.length > LONG_HEADLINE ? 58 : 70,
            lineHeight: 1,
            letterSpacing: -1.4,
          }}
        >
          {en.h1}
        </div>
        <div
          style={{
            marginTop: 18,
            fontFamily: "Instrument Serif",
            fontSize: en.h1.length > LONG_HEADLINE ? 28 : 32,
            lineHeight: 1.15,
            color: OG_COLORS.secondary,
          }}
        >
          {es.h1}
        </div>
        {/* Wraps between names only, never inside one (Mar Chiquita). */}
        <div
          style={{
            marginTop: "auto",
            display: "flex",
            flexWrap: "wrap",
            rowGap: 6,
            fontFamily: "JetBrains Mono",
            fontSize: 16,
            color: OG_COLORS.accentSoft,
          }}
        >
          {names.map((name, i) => (
            <span key={name} style={{ whiteSpace: "pre" }}>
              {name}
              {i < names.length - 1 ? " · " : ""}
            </span>
          ))}
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: OG_MAP_BOX.left,
          top: OG_MAP_BOX.top,
          display: "flex",
        }}
      >
        <OgBasin shapes={OG_SHAPES[region]} width={OG_MAP_BOX.width} />
      </div>
    </OgFrame>,
    { ...size, fonts: OG_FONTS },
  );
}
