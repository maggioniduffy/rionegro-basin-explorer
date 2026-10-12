# Task: align the Río Negro Basin Explorer UI with the Landing v3 design

Read `CLAUDE.md` and `PLAN.md` first, then work in **plan mode**. Small commits. Do not
break the phase order in `PLAN.md`: the landing needs no pipeline data, so it can ship
now; the in-app restyling applies to whatever components already exist and becomes the
visual baseline for the ones built in later phases.

## Source of truth

Everything is in `design-reference/` (attached to this prompt):

- `landing.template.html` — the full landing markup + palette + EN/ES copy (readable, fonts stripped)
- `MapAccessCard.html` — the hero card component
- `basin.png` — hero image (841 KB, 1400x900)
- `landing-v3-bundle.html` — original bundle (renders in a browser; use it to compare visually)

The design files use a templating runtime (`{{ c.h05070a }}`, `style-hover`, `<x-dc>`). Do
**not** port that runtime. Translate to React + Tailwind + CSS variables. Open the bundle
in Playwright and take reference screenshots (EN/ES, dark/light, 1440 and 390 px) before
you start, to diff against later.

## 1. Design tokens

Define as CSS variables on `:root` (dark, default) and `:root[data-theme="light"]`; expose
them through the Tailwind config. Do not hardcode hex values in components.

| Token                                          | Dark               | Light                 |
| ---------------------------------------------- | ------------------ | --------------------- |
| bg                                             | #05070a            | #f5f6f4               |
| text                                           | #e8edf2            | #0b0f14               |
| accent                                         | #22b8ff            | #0071a8               |
| accent-soft (river flow)                       | #8fd8ff            | #4fb3e8               |
| on-accent                                      | #021018            | #ffffff               |
| text-secondary                                 | #9aa4af            | #4f5964               |
| text-body                                      | #a8b1bb            | #4a545e               |
| text-strong-muted                              | #c5ccd4            | #2f3842               |
| text-tertiary                                  | #7c8793            | #5c6670               |
| text-footer                                    | #8a95a1            | #5c6670               |
| surface (cards)                                | #0b0f14            | #ffffff               |
| surface-raised (panels)                        | #0f1318            | #ffffff               |
| surface-active (segmented/selected)            | #1d232b            | #e6ebf0               |
| icon-muted / separator-text                    | #5c6670            | #9aa4af               |
| track (slider rail)                            | #2a323c            | #d5dbe1               |
| stage (card preview bg)                        | #000               | #e4e8ec               |
| fg-rgb (for borders `rgba(var(--fg),.09–.16)`) | 255,255,255        | 11,15,20              |
| bg-rgb (vignette)                              | 5,7,10             | 245,246,244           |
| panel-glass                                    | rgba(15,19,24,.94) | rgba(255,255,255,.95) |
| chip-glass                                     | rgba(10,14,19,.86) | rgba(255,255,255,.92) |
| image-fade                                     | rgba(11,15,20,.9)  | rgba(245,246,244,0)   |

Sub-basin legend colors (from the card): cyan #22b8ff, orange #ff8a2a, violet #8f7bff.
Use them as the categorical palette for the sub-basin layer; check they stay distinguishable
on the satellite imagery and in both themes.

Radii: cards 14px, panels/chips 10px, buttons/segmented 6–8px, pills 999px, CTA 10px.
Borders: 1px `rgba(fg, .09)` cards, `.10–.14` controls, `.16` pills; hover border = accent.
Shadows: card hover `0 20px 60px -20px rgba(34,184,255,.35)` dark / `0 20px 50px -24px rgba(0,113,168,.45)` light;
rest `0 20px 60px -30px rgba(0,0,0,.8)` dark / `0 16px 40px -28px rgba(11,15,20,.35)` light.
Glass surfaces use `backdrop-filter: blur(6px)`.

## 2. Typography (load with `next/font/google`, no external `<link>`)

- **Instrument Sans** 400/500/600 — UI and body
- **JetBrains Mono** 400/500 — eyebrows (12px, uppercase, .14em tracking), numeric values, attribution lines
- **Figtree** 500 — wordmark only ("Río Negro Basin Explorer", -.01em)
- h1: `clamp(36px,6.4vw,80px)`, weight 500, line-height 1.02, tracking -.035em, `text-wrap: balance`
- h2: `clamp(26px,3.6vw,44px)`, weight 500, tracking -.025em
- body/sub: `clamp(16px,1.6vw,19px)` / 1.55; card body 15px / 1.55; `text-wrap: pretty`

## 3. Landing page (`/[locale]`)

Sections, in order (exact markup and spacing in `landing.template.html`):

1. **Header** — logo mark + wordmark (home link), "Attributions" link, theme toggle button
   (moon icon, `aria-pressed`, label flips Light/Dark theme), globe icon + EN/ES segmented
   control (real locale links to `/en` and `/es`, active one filled with accent).
2. **Hero** — full-bleed SVG of the river network behind the text (static strokes at
   `stroke-opacity .22` + 4 animated `.rn-flow` strokes using `stroke-dasharray:60 180`,
   14s linear `stroke-dashoffset` loop, staggered `animation-delay`; must be disabled under
   `prefers-reduced-motion`), radial vignette to bg, then eyebrow, h1, subtitle,
   and the **MapAccessCard**.
3. **Explore** — 3-column auto-fit grid (min 320px) of feature cards: Rivers & tributaries
   (river panel mock), Sub-basins (Basin/Sub-basins toggle + breadcrumb + tributary chips),
   Visible land (cropped basin.png + slider mock). Footnote "* Modeled or estimated values."
4. **Data note** — "Modeled, not measured." two-column block with link to Attributions.
5. **Footer** — wordmark, Attributions, imagery/data credit line, EN/ES links, "Open map →".

**MapAccessCard**: the whole card is one link to `/[locale]/map`. 16:9 image area with
hover zoom (1.05) + brightness (1.18), two glass chips over the image (river stats top-left,
sub-basin legend top-right), credit line bottom-left, then title/text and a 48px accent CTA
("Open map →", arrow nudges 5px on hover). Focus: 3px accent outline, offset 4px.
Below it, a row of quick-link pills: Limay, Neuquén, Río Negro →
`/[locale]/map?r=limay|neuquen|negro` (use the same `?r=` slug scheme as the map state in
`PLAN.md`; confirm the slugs match what the pipeline will emit).

Logo mark (reuse as a React component, `currentColor`):

```svg
<svg width="34" height="20" viewBox="25 75 910 550" aria-hidden="true">
  <g fill="currentColor" stroke="currentColor" stroke-width="50" stroke-linejoin="round">
    <path d="M55 151C170 128 280 105 380 106C470 108 520 150 570 230C620 315 670 372 740 382C800 388 860 376 903 362C860 385 800 405 745 400C660 392 600 330 520 262C450 195 400 152 310 149C230 147 150 150 55 151Z"/>
    <path d="M178 594C270 510 370 376 490 376C570 376 650 440 725 458C800 474 870 420 903 362C880 420 830 478 730 486C650 490 590 465 520 455C440 442 370 470 178 594Z"/>
  </g>
</svg>
```

Also generate a favicon from it. Hero river paths: copy the `viewBox="0 0 1440 700"` SVG from
`landing.template.html` verbatim into a component.

## 4. Apply the same language to the app (`/[locale]/map` and shared components)

Do this against the components that already exist; leave TODO-free stubs for the rest.

- App shell uses the same bg, tokens and fonts; the header matches the landing header
  (logo, theme toggle, locale switcher), compact.
- **River panel / sub-basin panel**: `panel-glass` surface, 10px radius, 1px border,
  title 16px/600, key-value rows separated by `1px rgba(fg,.07)` lines with label in
  text-secondary and value in text (600; JetBrains Mono for numbers is allowed, be
  consistent), breadcrumb with underlined ancestor links and `›` separators, tributary chips
  as 999px outlined pills with a "+N" overflow. Every panel that shows discharge or
  population must show the modeled-data caveat (CLAUDE.md rule 4), marked with `*`.
- **Basin / Sub-basins toggle**: 2-segment control (selected = surface-active, 600).
- **Visible Land slider**: 4px track, accent fill, 16px accent thumb with 2px surface border,
  labels "Rivers only" / "Whole basin" at the ends.
- Buttons: min 36px (nav) / 44–48px (primary/touch); focus ring `2px solid accent`, offset 2px.
- Dark/light toggle wired to one source of truth: `data-theme` on `<html>`, persisted
  (cookie so the server can render the right theme without a flash), default dark,
  respect `prefers-color-scheme` only if nothing is stored. The MapLibre style must switch
  with the theme (mask color, label colors); keep imagery unchanged.
- Mobile (<640px): panels become a bottom sheet (already planned in Phase 7; only match the
  tokens now), header wraps as in the landing.

## 5. i18n

All strings in `/messages/en.json` and `es.json` under a `landing` namespace; no hardcoded
text. Copy from the design (keep the Spanish voseo as designed, it is intentional):

```json
// en
{
  "attr": "Attributions",
  "eyebrow": "Río Negro basin · Patagonia, Argentina",
  "h1": "Follow the water from the Andes to the Atlantic.",
  "sub": "Explore the Limay, Neuquén and Negro rivers, their tributaries and sub-basins on satellite imagery.",
  "exTag": "What you can explore",
  "exH": "One basin, three ways in.",
  "f1h": "Rivers & tributaries",
  "f1p": "Select any stream for its length, source and mouth elevation, Strahler order, discharge and more.",
  "f2h": "Sub-basins",
  "f2p": "Switch from the whole basin to Limay, Neuquén and Río Negro, then drill into finer levels with breadcrumb navigation.",
  "f3h": "Visible land",
  "f3p": "Slide from rivers only to the whole basin, revealing the satellite imagery around the water.",
  "sample": "* Modeled or estimated values.",
  "dTag": "Data & transparency",
  "dH": "Modeled, not measured.",
  "d1": "Built on HydroRIVERS, HydroATLAS and HydroBASINS, with IGN data for Argentine watercourses.",
  "d2": "Discharge and population are modeled long-term averages (1971–2000). They do not reflect current dam regulation at El Chocón, Piedra del Águila, Alicurá and others.",
  "credit": "Imagery: EOxCloudless · Data: HydroSHEDS, GIRES, IGN, OSM",
  "open": "Open map",
  "card": {
    "title": "Open the explorer",
    "text": "Satellite imagery of the basin with rivers, tributaries and sub-basins, in one map.",
    "btn": "Open map",
    "quick": "Jump to"
  }
}
// es: use the `es` block in landing.template.html verbatim (same keys)
```

Also move the small labels (Length, Strahler order, Mean discharge, Basin, Sub-basins,
Rivers only, Whole basin, Flows into, Light/Dark theme, Toggle theme) into the shared namespace
so the app panels reuse them. Proper nouns (Río Limay, Río Neuquén, Agrio, Covunco, ...)
are not translated.

## 6. Things to fix or verify instead of copying blindly (CLAUDE.md rules 2, 3, 9)

1. **Sample numbers.** The design hardcodes "555,3 km", "Strahler 6", "762,2 m³/s", the
   Neuquén tributary chips (Agrio, Covunco, Curi Leuvú, Trocomán, +2) and the Río Limay
   card. These are mockup values, not sourced. Do not ship them as facts: either read them
   from the seed data at build time once Phases 1–3 exist, or keep them visibly labeled as an
   illustrative example. Until then, leave the numbers as placeholders behind a
   clearly named constant and tell me.
2. **Number formatting.** The design shows comma decimals ("555,3 km") in the _English_
   version too. Format with `Intl.NumberFormat(locale)` (EN `555.3`, ES `555,3`), and make
   units respect the km/mi toggle in `lib/units.ts`.
3. **Imagery license.** The design credits "EOxCloudless" (EOX Sentinel-2 cloudless), while
   `PLAN.md` references Esri World Imagery. I have not verified the license/attribution
   terms of either for a public site, and the cloudless layer's terms may differ by year
   and may restrict commercial use. Check the current terms, record them in
   `/pipeline/SOURCES.md`, make the tile URL an env var, and keep the footer credit text in
   sync with whatever is actually used. This closes the "Imagery provider and license" open decision.
4. **`basin.png`.** It is a mockup render with orange and white dots whose meaning
   (dams? localities?) is not documented, and its file metadata carries content-credentials
   (C2PA) markers, so I am not sure how it was produced. Use it only as the placeholder hero
   image. For release, regenerate it from the real map (Playwright screenshot of the
   masked basin with the real rivers), then serve it via `next/image` as AVIF/WebP with
   `priority`, explicit width/height and meaningful `alt` (EN/ES, as in the card).
5. **Light theme contrast.** Verify WCAG AA for text-secondary/tertiary and accent on the
   light surfaces; adjust tokens if any pair fails.
6. The design's links use relative `attributions` and `map`; implement them as locale-prefixed
   routes. Create the Attributions page (even minimal, fed from `SOURCES.md`) so the
   links are not dead.

## 7. Acceptance

- `npm run check` passes; all new strings exist in both locales.
- Playwright screenshots (EN/ES x dark/light x 1440/390) of the landing, compared to the
  reference screenshots; report any intentional deviation.
- No horizontal scroll at 390px; tab order and visible focus rings on every interactive
  element; animation off under `prefers-reduced-motion`.
- Lighthouse a11y and performance pass on the landing (hero image is the LCP element).
- Update the `PLAN.md` checklist only for what is actually done, and list the open
  questions from section 6 in your final message.
