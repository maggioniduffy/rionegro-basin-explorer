<!-- Phase file. Index and status: [PLAN.md](../PLAN.md). Source notes: [i1-water-source-options.md](i1/i1-water-source-options.md). -->

# W1 — DSWx-first water detection (parallel track, not started)

Owner idea, 2026-10-28. A parallel branch of the plan beside I1.T; nothing is decided or scheduled yet. No branch
until the checks below are done.

## Idea (owner, 2026-10-28, verbatim)

> I think it would more efficient to make the flow/detector (water is already detected in OPERA DSWx) follows OPERA
> DSWx first and in any case correct with the algorithm. I know is only one photo, but was a complicated one.
>
> It will be more quick to extend the feature to other rivers too, and maybe there is another source in earth data
> more accurate.

In short: OPERA DSWx-HLS becomes the primary water mask; our Sentinel-2 MNDWI detector (`pipeline/py/flowwater/`)
only corrects it where it fails (for example arms narrower than DSWx's 30 m pixels). Expected gains: less tuning
per reach, and a faster path to other rivers.

Limit of the "faster to other rivers" gain: DSWx removes the per-reach detection tuning (thresholds, cloud and
scene choice) because its classification is the same everywhere. The rest of the per-river work stays: courses and
sections, corridor filtering, skeleton and flow direction, reservoir zones. Rivers whose arms are mostly under
~60 m wide would still lean on the Sentinel-2 correction.

Principle (owner, 2026-10-28): the correction has to learn, not be instructed in each section. No per-section
thresholds or rules; one correction trained once (DSWx as labels where it is reliable, plus owner-approved
sections) that generalizes to new reaches and rivers. Open question: DSWx labels are 30 m and weakest exactly on
narrow arms, so those need other labels (owner-approved sections, DSWx partial water as a soft label).

Evidence so far: one DSWx scene at the Limay–Neuquén confluence (owner's Earthdata Search look) with a continuous
main channel and mostly connected side arms; noise from scattered partial water on the city and fields, and
probable snow/ice specks. One scene only.

## To check before starting

- [ ] Compare DSWx with our current mask on the hard captures (the sections that failed owner checks), using
      `flow-water probe`. Record per-section results here.
- [ ] Multi-date: does a DSWx water frequency over several dates beat single scenes (clouds, the partial-water noise)?
- [ ] Narrow braids upstream: where does DSWx break arms that Sentinel-2 10 m keeps?
- [ ] Access and volume: `earthaccess` / CMR-STAC, Earthdata login in the remote pipeline, size per section, no
      recurring cost.
- [ ] License via `license-checker`; entry in `pipeline/SOURCES.md`.

## To investigate together: better datasets

Look in Earthdata and elsewhere for a water product more accurate than DSWx-HLS for narrow channels. Candidates
noted so far are in [i1-water-source-options.md](i1/i1-water-source-options.md) (JRC Global Surface Water,
Dynamic World 10 m). HLS dropped: the owner compared it with DSWx on 2026-10-28 and DSWx was better.
Also worth a look: other OPERA DSWx variants (for example a Sentinel-1 radar one, which would see through clouds) and whether they cover Argentina.

## Done when

Not defined yet: write acceptance once the checks above settle whether DSWx-first replaces, leads or only
references the current detector. The decision goes to [DECISSIONS.md](../DECISSIONS.md).
