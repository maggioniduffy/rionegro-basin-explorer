<!-- Phase file. Index and status: [PLAN.md](../PLAN.md). -->

# Phase B1 — Content bucket and remote pipelines

**Plan approved by the owner on 2026-10-19.** Branch `phase-b1-bucket-remote-pipelines` (cut from
`phase-f3-flow-network`; rebase on main after PR #10 merges). B1.1 and B1.2 implementation is committed as
`b088bf9` and `bd9c845`; the workflow action SHA fix is `fb5b81a`. The B1.1/B1.2 owner uploads and live checks
below remain pending. The "Scope (proposed)" and "Open points" sections are kept for history.

**Owner-reported status (2026-10-19):** R2 buckets and repository secrets are configured; no objects have been
uploaded. Only `check` is registered on GitHub because this phase branch has not been pushed. Public generated
files remain tracked until the Vercel Preview Range/cache check passes.

## Why

- **Git history, not the Vercel limit.** `public/` is 32 MB against 100 MB per Vercel Hobby CLI upload, so the
  limit is not urgent. But every pipeline rerun commits the changed tiles and flow files again, and `.git` is
  already 111 MB (2026-10-18). This grows with more regions and with every published net.
- **Long runs.** `flow-water` takes about 40–60 s per section cold and 9–14 MB of cache each (about 11 GB for all
  `nqn`). It already runs in resumable batches (F3.1), so it can be split across machines.

## Scope (proposed)

1. **Content bucket.** Move the PMTiles tiles and `public/flow/<region>/` (sections and nets) to object storage.
   This closes the open decision "PMTiles hosting (`/public` vs object storage)" in PLAN.md.
   - Requirements: HTTP Range (PMTiles needs it), CORS, and the content hash in the path, as in today's
     versioning (`next.config.ts` `flowVersions`, tiles).
   - Candidates:
     - Cloudflare R2: no egress fee and a free tier (from memory; not verified).
     - Vercel Blob.
     - S3: charges egress.
2. **Remote pipelines**, mainly `flow-water`.
   - **GitHub Actions** matrix, one job per river or range using the F3.1 batches. Each job uploads its nets as an
     artifact or to the bucket. To verify:
     - free minutes (they depend on whether the repo is public or private);
     - the 6 h limit per job;
     - about 14 GB of disk per runner.
   - **Alternative: a VM in AWS us-west-2**, where Earth Search lives. Faster downloads and probably no transfer
     cost, but it is a recurring cost.

## Open points

- `data/raw` dependencies (IGN, HydroLAKES) would have to live in a private bucket for remote runs. Check that
  each licence allows copying them there.
- Every cost and limit figure above comes from memory and is not verified.

## Approved plan (owner, 2026-10-19)

### Context

`.git` is 113 MB and grows with every pipeline rerun, because the tiles (`public/tiles`, 20 MB) and flow files
(`public/flow/nqn`, 923 files, 7.7 MB) are committed. `flow-water` needs 40–60 s per section, and the owner can't
leave the machine running. B1 moves those files to object storage and runs `flow-water` on GitHub Actions. That
unblocks the 18 remaining El Chocón/Arroyito sections and whole-reservoir nets.

Branch: `phase-b1-bucket-remote-pipelines`, cut from `phase-f3-flow-network` because PR #10 is still open. It is
rebased onto main after #10 merges, and the PR targets main.

### Verified facts (2026-10-19, scouts)

| Item                     | Figure                                                                                                                                                                                                | Source                                        |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| R2 free tier             | 10 GB-month, 1M Class A, 10M Class B per month, **$0 egress**                                                                                                                                         | developers.cloudflare.com/r2/pricing          |
| R2 activation            | Needs an R2 subscription through dashboard checkout. **Whether a card is required is UNVERIFIED** (owner sees it at signup).                                                                          | r2/get-started                                |
| R2 public access         | r2.dev is rate-limited and "non-production". A custom domain must be a Cloudflare zone. CORS and Range are supported.                                                                                 | r2/buckets/public-buckets                     |
| Vercel Blob Hobby        | 1 GB, 10 GB transfer. **Over the limit the store is blocked for 30 days.** Rejected: that would take the map offline.                                                                                 | vercel.com/docs/vercel-blob/usage-and-pricing |
| S3                       | $200 credits for 6 months, then about $0.09/GB egress with no cap. Rejected as a recurring cost.                                                                                                      | aws.amazon.com/s3/pricing                     |
| Actions, public repo     | The repo is **PUBLIC**, so standard runners are free. 6 h per job, 256 matrix jobs, 20 concurrent. ubuntu-latest has 4 CPU, 16 GB RAM, 14 GB SSD. Artifacts get 500 MB free, then $0.25/GB.           | docs.github.com billing, limits, runners      |
| Earth Search / GLO-30    | Unsigned AWS Open Data, no account. Not requester-pays (inferred; a caveat).                                                                                                                          | registry.opendata.aws                         |
| Vercel external rewrites | The CDN caches upstream `cache-control`. Projects created before 2026-04-06 need the `x-vercel-enable-rewrite-caching: 1` header. **Range passthrough is UNVERIFIED** and is the first check in B1.1. | vercel.com/docs/rewrites                      |

**`flow-water` remote inputs** (from the code):

- `regions/nqn/flow-water.config.json` and `public/flow/nqn/` (the IGN course is already in the published sections).
- `data/work/nqn/lakes/lakes.geojson`, a 500 KB HydroLAKES clip used only for the IoU check and the `inputsHash`.

**No raw IGN is needed remotely.** Scene locks live in `cache/<id>/scenes.lock.json`.

**Licences** (license check skipped by the owner, 2026-10-19):

- The only file copied to the private bucket is `lakes.geojson`. It is derived from HydroLAKES, which is CC BY 4.0
  (`pipeline/SOURCES.md:16`, read 2026-09-30), so copying it is allowed with attribution.
- Raw IGN (custom terms, not CC BY) is **not** copied: the remote runs don't need it.
- Sentinel-2 and GLO-30 are fetched at run time from AWS Open Data, as they are locally.

### Licence check (license-checker, 2026-10-19)

- **HydroLAKES**: CC BY 4.0 on the product page, so a private copy of `lakes.geojson` is allowed with attribution. The
  hydrosheds.org Terms of Use say "You also may not, without HYDROSHEDS's permission, 'mirror' any material contained
  on this Site on any other server". That reads as covering the site's own materials, since data products follow their
  product-page licence, but this is not certain. Low risk: the bucket holds a 500 KB derived clip, not the original
  dataset. If in doubt, rebuild it from the source URL on each run.
- **IGN**: not copied (remote runs don't need it). The terms page was unreachable on 2026-10-19.
- **HydroRIVERS**: under the HydroSHEDS v1 licence, a private copy used only by CI is reproduction, not
  distribution. Not needed remotely.
- **Sentinel-2 / GLO-30**: fetched anonymously at run time; nothing to mirror.

### Design

**Hosting (recommended):** Cloudflare R2, **with no custom domain**. Next.js rewrites send
`/tiles/:region/:version/:file` and `/flow/:region/:version/:file` to `${CONTENT_ORIGIN}/…` (r2.dev). The
`cache-control: immutable` set on upload, plus the rewrite-caching header, lets Vercel's CDN absorb the traffic:
r2.dev sees only cache misses, so its rate limit doesn't matter.

- App URLs are unchanged and same-origin, so there is no CORS and no client change.
- Transfer counts against Vercel's 100 GB Fast Data Transfer, as today.
- Fallback if Range doesn't pass through the rewrite: the client fetches the bucket directly. That needs CORS,
  and in practice a custom domain, which is a recurring cost of about $10/yr. An owner decision then.

**Versioning:** keep today's per-region content hash. A shared `lib/content-hash.ts` (used by `next.config.ts`
and the publish script) computes it. A committed `content/versions.json` (`{tiles: {nqn, cba}, flow: {nqn}}`)
replaces build-time hashing when `CONTENT_ORIGIN` is set. Objects live at `tiles/<region>/<hash>/<file>` and are
never overwritten or deleted. Old deployments and open pages keep working, and Vercel rollback stays safe.
Local dev without `CONTENT_ORIGIN` serves `public/` as today. A fresh clone sets `CONTENT_ORIGIN` to read the
bucket.

**Two buckets:**

- `basin-content`: public through r2.dev, holds tiles and flow.
- `basin-pipeline`: private, holds `inputs/nqn/lakes.geojson`, plus `flow-water/nqn/out/*` and the scene locks, so
  remote runs resume.

Credentials are repo secrets. The workflow runs on `workflow_dispatch` only, never on `pull_request`, so forks
can't reach the secrets.

**Git:** `public/tiles/` and `public/flow/` become gitignored and untracked, kept locally as pipeline output.
Steps are unchanged. History is **not** rewritten; shrinking `.git` would need a force push, which is a separate
owner decision.

### Work packages

#### B1.0 — Owner actions (blocking B1.1 upload, B1.2 runs)

1. Create a Cloudflare account and activate R2 (check whether a card is asked for; report it).
2. Create buckets `basin-content` (enable r2.dev public access) and `basin-pipeline` (private).
3. Create an R2 API token, Object Read & Write, scoped to the two buckets.
4. Add repo secrets `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`. Add Vercel env
   `CONTENT_ORIGIN=https://pub-…r2.dev` (Preview and Production).
5. Enable repo setting: "Allow GitHub Actions to create pull requests".

Meanwhile builders write code against those names; nothing is uploaded until the owner is done.

#### WP B1.1 — Content bucket and versioned publish _(reviewer: secrets, cost)_

- Goal: tiles and flow are served from R2 through same-origin rewrites, and the repo stops tracking them.
- Region(s): shared. Every region's files go under its own prefix, with no fallback across regions.
- Files:
  - `lib/content-hash.ts` (new; extracts the hashing out of `next.config.ts`)
  - `next.config.ts`: read the manifest when `CONTENT_ORIGIN` is set, and add the external rewrites plus the
    `x-vercel-enable-rewrite-caching` and immutable headers
  - `content/versions.json` (new)
  - `scripts/content-publish.ts` (new, `npm run content:publish -- --region <id> [--kind tiles|flow]`). It
    hashes, uploads missing objects with the S3 client under the hashed prefix and `Cache-Control: immutable`,
    then writes the manifest. It is idempotent and writes `data/work/<region>/content-publish/report.json`
    (files, bytes, uploaded/skipped).
  - `scripts/content-pull.ts` (download one version prefix into `public/`, for CI and fresh clones)
  - `.gitignore`, `package.json` (`@aws-sdk/client-s3` devDependency), `.env.example`
  - `pipeline/README.md` (publish step), `context/DECISSIONS.md` (by Opus)
- Contracts: `tilePaths` and `flowPaths` stay unchanged (`lib/map/config.ts:74`, `lib/flow/data.ts:22`).
  `parseTilesVersions` reads the same env JSON. Secrets come only from env in scripts; nothing is `NEXT_PUBLIC_`
  except the versions.
- Before the switch: a sweep (scout) for tests, scripts or build steps that read `public/tiles|flow`
  (`scripts/og-shapes.ts` is local-only, fine), and the `check.yml` CI needs.
- Acceptance:
  - `npm run check`
  - one unit test: the manifest hash equals `lib/content-hash.ts` on a fixture dir
  - publish run twice: the second run uploads 0 objects
  - **owner check on a Vercel preview**: `curl -sI -r 0-99 <preview>/tiles/nqn/<hash>/rivers.pmtiles` returns
    206 and `x-vercel-cache` turns HIT on repeat; the map and flow load with no console errors
- Out of scope: history rewrite, a custom domain, moving `regions/*` generated files.

#### WP B1.2 — GitHub Actions `flow-water` in batches _(reviewer: secrets, cost)_

- Goal: `gh workflow run flow-water.yml -f region=nqn -f only=<ids/ranges> -f chunk=10` processes sections in
  parallel jobs, resumably, and opens a PR with the published nets.
- Files:
  - `.github/workflows/flow-water.yml` (new)
  - `scripts/flow-water-plan.ts` (new: expands `--only`/`--rivers` the same way `select_ids` does, splits the
    list into chunks, emits the matrix JSON)
  - `pipeline/README.md`
- Jobs:
  1. **plan**: emit the matrix.
  2. **run** (matrix, `max-parallel: 4`, `timeout-minutes: 120`): checkout, uv sync (`--frozen`),
     `content:pull` the flow version from the manifest, fetch `lakes.geojson` and the earlier `out/` and locks
     for its ids from `basin-pipeline`, then `npm run pipeline:flow-water -- --region nqn --only <chunk>`, then
     upload `out/<id>.*` and `cache/<id>/scenes.lock.json` (never the `.npz` caches).
  3. **publish** (needs: run, `if: always()`): pull every `out/`, rebuild `report.json` (a run with done ids is
     a no-op), `pipeline:flow-net-publish`, `content:publish --kind flow`, then open a PR on
     `b1-nets-<run_id>` with `content/versions.json` and a report summary in the body.
- Constraints: `permissions:` least privilege (`contents: write` and `pull-requests: write` only on publish).
  Secrets are never echoed. Action versions are pinned. `--region` is required, with no default.
- Acceptance: `npm run check`; `actionlint` passes on the workflow (if available); a dry dispatch on 1 already-done
  section (`limay-110`) skips it and the publish PR shows no net diff.
- Out of scope: a self-hosted runner or VM.

#### WP B1.3 — First remote batch (data, no code)

- Dispatch with `only=limay-084..limay-095,limay-097..limay-102`, `chunk=6` (3 jobs). The pipeline runner reads
  the pulled `report.json`; Opus reviews the gate result. Merge the PR into the phase branch.
- Acceptance: 18 section reports with no error; `flow-net-publish` report all checks pass; the nets budget is
  under 4 MB.

#### WP B1.4 — Whole reservoirs and zoom _(reviewer: data provenance)_

- Pipeline (Python):
  - Scope: El Chocón and Arroyito groups only. The index has 58 reservoir sections: Alicurá, Piedra del Águila,
    Pichi Picún Leufú, El Chocón and Arroyito on the Limay, plus `agrio-003` and `varvarco-001`. The others reuse
    the mechanism in later batches.
- Reservoir **groups** in `flow-water.config.json` `lakes: [{id, hylakId, sections: "limay-076..limay-095"}]`,
  explicit and traceable to HydroLAKES ids. The ids are listed from `lakes.geojson`, and the owner confirms the
  member ranges.
  - A group runs the existing pipeline on a virtual section: the concatenated course of its members, with AOI =
    course buffer ∪ (lake polygon buffered by `lakeMarginM`).
  - One net per group (`lake-<hylakId>.net.json`); members point to it. Resolution stays 10 m unless the grid
    estimate exceeds a memory budget, in which case use `lakes[].resolutionM: 20` (measured first, reported).
  - `FLOWWATER_VERSION` bump.
- Publish: `flow-net-pub` keeps `driftFrom` (orchestration §8 finding). `nets.json` gains
  `groups: {netId: [sectionIds]}`.
- App (`lib/flow/data.ts`, network loading, flow view):
  - A member section loads its group net and the camera fits the lake.
  - A new display constant sets a lower minimum zoom for reservoir drift (exact value to set in the brief after
    reading the flow layer code).
  - Strings in both locales, if the panel changes.
- Then rerun the groups remotely (B1.2) and publish.
- Acceptance: `npm run check`; one test for the group lookup (a section that maps to its group net, and one
  that doesn't). The report shows the El Chocón polygon IoU against HydroLAKES 981 over the whole lake, and no
  straight AOI edge in open water (QA: the polygon touches the grid border only on land). Owner browser pass.

#### Phase gate

§6 of orchestration.md:

- Reviewer runs on `git diff main...HEAD`.
- PLAN.md: close the open decision "PMTiles hosting" and update the B1 row.
- DECISSIONS.md: add "Phase B1".
- Phase file: tick the checklist and add owner checks.
- Open the PR.

### Recurring cost flags

- R2: $0 at about 30 MB. The risk is more than 10M Class B reads per month. Low, because the Vercel CDN caches
  immutable objects.
- Vercel: transfer unchanged (100 GB Hobby).
- Actions: $0 while the repo is public. **If it goes private**: 2,000 min/month and 2-CPU runners.
- Possible: a custom domain (about $10/yr), only if B1.1's Range check fails.

### Verification

- `npm run check` per WP.
- `content-publish` report (an idempotent second run).
- Preview `curl -r` returns 206 and the cache HIT.
- Workflow run logs and the pulled `flow-water` / `flow-net-publish` reports.
- Owner browser pass for B1.4.

## Owner checks

- [x] Publish `nqn` tiles and flow, then `cba` tiles; repeat each publish and confirm the reports show
      `uploaded: 0` on the second run. Commit `content/versions.json` before setting Vercel `CONTENT_ORIGIN`.
      Done 2026-10-19: nqn 928 files (tiles `3768b61d8bf0`, flow `4a8bce066be4`), cba 5 tiles
      (`d7e595549414`, `--kind tiles`); second runs `uploaded: 0`.
- [ ] Upload `data/work/nqn/lakes/lakes.geojson` to `basin-pipeline` with `flow-water:sync --mode push-inputs`.
- [ ] Seed `basin-pipeline` with every non-error local `out/*.report.json` section and verify object key counts
      without printing object contents. This prevents the net publisher from dropping existing local nets.
- [ ] Choose whether to register `flow-water.yml` through a small PR to `main` or wait for the phase PR; enable
      GitHub Actions pull-request creation.
- [ ] After the workflow is available on GitHub, dispatch the already-done `limay-110` dry run and check its
      reports and version hash.
- [ ] Set Vercel `CONTENT_ORIGIN` for Preview and Production. On a Preview, verify a byte range returns 206,
      a repeated request is a CDN HIT, and the map/flow load without console errors.
- [ ] Only after that Preview check, untrack `public/tiles` and `public/flow` in a separate commit.

## Work packages (original proposal)

- [ ] B1.1 Bucket, and publishing tiles and flow files to it with content-hashed paths
- [ ] B1.2 GitHub Actions workflow for `flow-water` in batches
- [ ] B1.3 First remote batch: the rest of F3's batch 1, 18 sections (`limay-084..limay-095`,
      `limay-097..limay-102`: lower El Chocón, the reach between the dams, Arroyito and below its dam), then
      `pipeline:flow-net-publish -- --region nqn`. Locally it would be
      `npm run pipeline:flow-water -- --region nqn --only limay-084..limay-095,limay-097..limay-102`.
- [ ] B1.4 Reservoirs whole, not boxed (F3 browser pass, owner 2026-10-19). Today the water mask is computed on
      the bounding box of a 1500 m buffer of each section's course (`corridorM`), so El Chocón's polygon ends in
      straight edges in open water (`limay-076..083`), and particles show only at zoom ≥ 12 for one section at a
      time. Options to plan:
  - an AOI that grows to the whole water body that touches the course (e.g. bounded by the HydroLAKES polygon
    plus a margin), or one reservoir net per lake shared by the sections that cross it;
  - in the app, draw the neighbouring sections' nets (or the shared reservoir) together, and a lower minimum
    zoom for reservoir drift.

  Needs a rerun of the reservoir sections (remote, B1.2), then `flow-net-publish`.
