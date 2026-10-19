<!-- Phase file. Index and status: [PLAN.md](../PLAN.md). -->

# Phase B1 — Content bucket and remote pipelines

Not started. Proposed by the owner on 2026-10-18, to run after F3. Nothing here is decided: plan it in plan mode
first, and verify every cost figure before choosing (Rule 8).

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

## Work packages (proposed)

- [ ] B1.1 Bucket, and publishing tiles and flow files to it with content-hashed paths
- [ ] B1.2 GitHub Actions workflow for `flow-water` in batches
- [ ] B1.3 First remote batch: the rest of F3's batch 1, 18 sections (`limay-084..limay-095`,
      `limay-097..limay-102`: lower El Chocón, the reach between the dams, Arroyito and below its dam), then
      `pipeline:flow-net-publish -- --region nqn`. Locally it would be
      `npm run pipeline:flow-water -- --region nqn --only limay-084..limay-095,limay-097..limay-102`.
