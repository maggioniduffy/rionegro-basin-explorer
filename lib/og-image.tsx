import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ReactNode } from "react";
import { MARK_PATHS } from "@/components/Icon";
import { OG_MAP_BOX } from "@/lib/og";
import type { OgShapes } from "@/regions/generated";

/**
 * Shared pieces of the Open Graph images (app/[region]/opengraph-image.tsx and
 * app/hub/opengraph-image.tsx), drawn in the Landing v6 dark theme. ImageResponse can't
 * read CSS variables, so the tokens of app/globals.css are repeated here.
 */
export const OG_COLORS = {
  bg: "#0b1320",
  text: "#eef0e8",
  secondary: "#a3adba",
  accent: "#22b8ff",
  accentSoft: "#8fd8ff",
  surfaceRaised: "#13233d",
  /** rgba(--fg-rgb, .16): the eyebrow pill's border. */
  lineStrong: "rgba(238, 240, 232, 0.16)",
  /** rgba(--fg-rgb, .35): lakes, as on the map (lib/map/style.ts THEME_COLORS). */
  lake: "rgba(238, 240, 232, 0.35)",
};

/** The site's faces (app/layout.tsx), as static Latin subsets in lib/og-fonts (OFL). */
const font = (file: string) =>
  readFile(join(process.cwd(), "lib/og-fonts", file));
const [serif, sans, mono] = await Promise.all([
  font("InstrumentSerif-Regular.ttf"),
  font("InstrumentSans-Medium.ttf"),
  font("JetBrainsMono-Medium.ttf"),
]);

export const OG_FONTS = [
  { name: "Instrument Serif", data: serif, weight: 400 as const },
  { name: "Instrument Sans", data: sans, weight: 500 as const },
  { name: "JetBrains Mono", data: mono, weight: 500 as const },
];

/** The page: navy, a soft accent glow behind the map, and the logomark with a name. */
export function OgFrame({
  brand,
  children,
}: {
  brand: string;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        position: "relative",
        background: OG_COLORS.bg,
        backgroundImage:
          "radial-gradient(circle at 78% 52%, rgba(34, 184, 255, 0.16), rgba(11, 19, 32, 0) 55%)",
        color: OG_COLORS.text,
        fontFamily: "Instrument Sans",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 72,
          top: 56,
          display: "flex",
          alignItems: "center",
          gap: 14,
          fontSize: 24,
          letterSpacing: -0.3,
        }}
      >
        <svg
          width={48}
          height={28}
          viewBox="50 100 860 500"
          fill={OG_COLORS.text}
        >
          {MARK_PATHS.map((d) => (
            <path key={d} d={d} />
          ))}
        </svg>
        {brand}
      </div>
      {children}
    </div>
  );
}

/** The landing's eyebrow: a pill with the accent dot. */
export function OgEyebrow({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        alignSelf: "flex-start",
        gap: 10,
        border: `1.5px solid ${OG_COLORS.lineStrong}`,
        borderRadius: 999,
        padding: "8px 18px",
        fontSize: 19,
        color: OG_COLORS.secondary,
      }}
    >
      <div
        style={{
          width: 8,
          height: 8,
          borderRadius: 999,
          background: OG_COLORS.accent,
        }}
      />
      {children}
    </div>
  );
}

/**
 * Basin, lakes and Strahler ≥ 4 rivers (regions/<id>/og-shapes.json, fitted to OG_MAP_BOX),
 * scaled to `width`.
 */
export function OgBasin({
  shapes,
  width,
}: {
  shapes: OgShapes;
  width: number;
}) {
  const scale = width / OG_MAP_BOX.width;
  return (
    <svg
      width={width}
      height={OG_MAP_BOX.height * scale}
      viewBox={`0 0 ${OG_MAP_BOX.width} ${OG_MAP_BOX.height}`}
    >
      {/* No stroke: the basin is pieced from z5 tiles, so a stroke would draw their seams. */}
      <path d={shapes.basin} fill={OG_COLORS.surfaceRaised} />
      <path d={shapes.lakes} fill={OG_COLORS.lake} />
      {shapes.rivers.map((r) => (
        <path
          key={r.strahler}
          d={r.d}
          fill="none"
          stroke={OG_COLORS.accent}
          strokeWidth={Math.max(0.6, (r.strahler - 3) * 0.7)}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}
