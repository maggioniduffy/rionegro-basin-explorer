<!-- Phase file. Index: [i1-imagery-water.md](../i1-imagery-water.md) · Plan: [PLAN.md](../../PLAN.md) -->

# I1.5 — Particle density control

- [ ] **I1.5 Particle density control** (independent, can go any time). Add a control in the flow bar
      (`components/flow/FlowControls.tsx`) to raise the particle count, e.g. 1× / 2× / 4× of `FLOW_PARTICLES` (3000
      per section today). It goes in the store with the playback speed, optionally as a URL param like `fs`, with
      labels in EN and ES. Resizing must reallocate the `ParticleState` buffers in `lib/flow/particles.ts` without
      restarting the section. Measure fps at 4× on a mid laptop before choosing the top option, and drop it if it goes
      below ~50 fps. With reduced motion, keep the default.
