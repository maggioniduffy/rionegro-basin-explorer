/**
 * The hero's river network (Landing v3, copied verbatim). Static strokes plus four
 * animated ones (.rn-flow in globals.css), which stop under prefers-reduced-motion.
 * Decorative: not a map of the real rivers.
 */
export function HeroRivers() {
  return (
    <svg
      viewBox="0 0 1440 700"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
      className="absolute inset-0 h-full w-full opacity-55"
    >
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        <g stroke="var(--accent)" strokeOpacity=".22" strokeWidth="1.2">
          <path d="M-20 80 C200 120 260 260 420 300 C560 330 700 300 820 360 C980 440 1100 420 1250 520 C1330 570 1400 600 1470 640" />
          <path d="M120 -20 C180 90 330 150 420 300" />
          <path d="M-20 420 C150 400 280 340 420 300" />
          <path d="M600 -20 C640 120 760 260 820 360" />
          <path d="M1000 -20 C1020 200 1120 330 1090 440" />
          <path d="M300 720 C380 600 520 560 700 470 C760 440 800 400 820 360" />
          <path d="M1440 300 C1340 330 1280 450 1250 520" />
        </g>
        <g stroke="var(--accent-soft)" strokeWidth="2">
          <path
            className="rn-flow"
            d="M-20 80 C200 120 260 260 420 300 C560 330 700 300 820 360 C980 440 1100 420 1250 520 C1330 570 1400 600 1470 640"
          />
          <path
            className="rn-flow"
            style={{ animationDelay: "-5s" }}
            d="M120 -20 C180 90 330 150 420 300"
          />
          <path
            className="rn-flow"
            style={{ animationDelay: "-9s" }}
            d="M300 720 C380 600 520 560 700 470 C760 440 800 400 820 360"
          />
          <path
            className="rn-flow"
            style={{ animationDelay: "-3s" }}
            d="M600 -20 C640 120 760 260 820 360"
          />
        </g>
      </g>
    </svg>
  );
}
