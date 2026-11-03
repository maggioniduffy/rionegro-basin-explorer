# Layout guide for the E1.7 analysis page

Owner-supplied reference (2026-11-03), from the design canvas
https://claude.ai/artifact/LPUfQ1KS8iZA9rkipwoi3Y ("Visor Neuquén", a climate viewer, sample data). Use it for
**layout and visual language only**; its content (rain, ENSO, ERA5) is not ours.

- `Main.dc.html`: wireframe. `Mockup.dc.html`: mockup with sample data and light/dark themes.
- What to borrow for `/[region]/effluents`:
  - Top bar with section tabs and a "data up to <date> · source" stamp.
  - Left column of controls (layers, filters, period); for us: outfall, scenario (mean / today / forecast day),
    basic inputs, and the closed "Model settings".
  - Main area with a detail card of facts: value + unit, range ("IC 90 %"), source, data period. For us: plume
    length, minimum DO and where, admissible load, required removal, each with its period and source.
  - "Observed vs normal (p25–p75), above p90" chart: maps to our flow scenario chart (GloFAS median with
    p25–p75 band against the climatology) and to the DO/coliform profiles along km.
  - A list of items with "see all", and a timeline strip along the bottom (fits E1.H historical runs and E1.W).
- Style: IBM Plex Sans + IBM Plex Mono for numbers; warm off-white ground (#F9F7F2, #ECE7DC), slate text
  (#16212A, #2A343B), one accent (#8EB8E5 blue on light, #FDDA0D yellow on dark). Reconcile with
  `context/DESIGN.md` before adopting fonts or colours; DESIGN.md wins on conflict.
- The `.dc.html` files are canvas sources (they need the canvas runtime); read them as markup, do not import them.
