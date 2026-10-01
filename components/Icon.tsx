import type { SVGProps } from "react";

// Identity & icon set v1 (claude.ai/design "Río Negro Basin Explorer icons").
// Single color: everything draws in currentColor.

/** Map UI icons: 24 grid, 1.5 stroke, round caps and joins. */
const ICON_PATHS = {
  river: "M3 8c4-3 8-3 11 0s5 3 7 1M3 16c4-3 8-3 11 0 2 2 4 2 7 0",
  subbasin: "M5 7l6-3 8 4-1 9-8 3-6-5z",
  basinToggle: "M4 6l8-3 8 4v10l-8 4-8-4zM4 6l8 5 8-4M12 11v10",
  search: "M15.5 15.5L20 20M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0z",
  layers: "M12 3l9 5-9 5-9-5zM3 12l9 5 9-5M3 16l9 5 9-5",
  mask: "M4 8h9M19 8h1M4 16h1M11 16h9M19 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM11 16a2 2 0 1 1-4 0 2 2 0 0 1 4 0z",
  theme: "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z",
  units:
    "M3 9.5A1.5 1.5 0 0 1 4.5 8h15A1.5 1.5 0 0 1 21 9.5v5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 14.5zM7 8v3M11 8v4M15 8v3",
  language:
    "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18",
  locate: "M12 3v3M12 18v3M3 12h3M18 12h3M18 12a6 6 0 1 1-12 0 6 6 0 0 1 12 0z",
  snapshot:
    "M4 8h3l2-3h6l2 3h3v11H4zM15.5 13a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0z",
  info: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zM12 11v5M12 8v.01",
  close: "M6 6l12 12M18 6L6 18",
  chevron: "M9 6l6 6-6 6",
  separator: "M14 5l-4 14",
} as const;

export type IconName = keyof typeof ICON_PATHS;

type IconProps = Omit<SVGProps<SVGSVGElement>, "children"> & {
  name: IconName;
  /** Rendered width and height in px (designed for 16, 24 and up). */
  size?: number;
};

/** Decorative by default: label the control that holds it, not the icon. */
export function Icon({ name, size = 16, ...props }: IconProps) {
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

/** Limay and Neuquén converging into the Río Negro. */
const MARK_PATHS = [
  "M55 151C170 128 280 105 380 106C470 108 520 150 570 230C620 315 670 372 740 382C800 388 860 376 903 362C860 385 800 405 745 400C660 392 600 330 520 262C450 195 400 152 310 149C230 147 150 150 55 151Z",
  "M178 594C270 510 370 376 490 376C570 376 650 440 725 458C800 474 870 420 903 362C880 420 830 478 730 486C650 490 590 465 520 455C440 442 370 470 178 594Z",
];

type LogomarkProps = Omit<SVGProps<SVGSVGElement>, "children"> & {
  /** Rendered width in px; height follows the mark's aspect ratio. */
  width: number;
};

/** The logomark. Below 40 px wide it switches to the heavier small-size cut. */
export function Logomark({ width, ...props }: LogomarkProps) {
  const small = width < 40;
  const [x, y, w, h] = small ? [25, 75, 910, 550] : [50, 100, 860, 500];
  return (
    <svg
      aria-hidden
      width={width}
      height={Math.round((width * h) / w)}
      viewBox={`${x} ${y} ${w} ${h}`}
      fill="currentColor"
      {...props}
    >
      <g
        stroke={small ? "currentColor" : undefined}
        strokeWidth={small ? 50 : undefined}
        strokeLinejoin={small ? "round" : undefined}
      >
        {MARK_PATHS.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
    </svg>
  );
}
