/** Sync resumable flow-water inputs/results with the private R2 pipeline bucket. */
import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { r2Client, r2Env } from "./lib/r2";

const SAFE = /^[a-z0-9-]+$/;
function value(name: string) {
  const at = process.argv.findIndex(
    (arg) => arg === name || arg.startsWith(`${name}=`),
  );
  if (at < 0) return undefined;
  const arg = process.argv[at]!;
  return arg.includes("=")
    ? arg.slice(arg.indexOf("=") + 1)
    : process.argv[at + 1];
}
function local(region: string, key: string) {
  if (key.includes("..")) throw new Error(`unsafe R2 key ${key}`);
  return path.join(process.cwd(), "data", "work", region, "flow-water", key);
}
async function download(
  bucket: string,
  region: string,
  key: string,
  missingOk = true,
) {
  try {
    const result = await r2Client().send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: `flow-water/${region}/${key}`,
      }),
    );
    const file = local(region, key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, await result.Body!.transformToByteArray());
    return true;
  } catch (error: unknown) {
    const status =
      typeof error === "object" && error && "$metadata" in error
        ? (error as { $metadata?: { httpStatusCode?: number } }).$metadata
            ?.httpStatusCode
        : undefined;
    if (missingOk && status === 404) return false;
    throw error;
  }
}
async function upload(bucket: string, region: string, key: string) {
  const file = local(region, key);
  if (!existsSync(file)) return false;
  await r2Client().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: `flow-water/${region}/${key}`,
      Body: await readFile(file),
    }),
  );
  return true;
}
const lakesFile = (region: string) =>
  path.join(process.cwd(), "data", "work", region, "lakes", "lakes.geojson");
async function pullLakes(bucket: string, region: string) {
  const file = lakesFile(region);
  await mkdir(path.dirname(file), { recursive: true });
  const lake = await r2Client().send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: `inputs/${region}/lakes.geojson`,
    }),
  );
  await writeFile(file, await lake.Body!.transformToByteArray());
}
async function main() {
  const region = value("--region");
  const mode = value("--mode");
  if (
    !region ||
    !SAFE.test(region) ||
    !["pull", "push", "collect", "push-inputs"].includes(mode ?? "")
  )
    throw new Error(
      "usage: --region <id> --mode pull|push|collect|push-inputs --only id,id",
    );
  const ids = (value("--only") ?? "").split(",").filter(Boolean);
  if (!ids.every((id) => SAFE.test(id))) throw new Error("invalid section id");
  const bucket = r2Env("R2_PIPELINE_BUCKET").bucket;
  const files = (id: string) => [
    `out/${id}.net.json`,
    `out/${id}.qa.geojson`,
    `out/${id}.report.json`,
    `out/${id}.water.tif`,
    `out/${id}.water.tif.aux.xml`,
    `cache/${id}/scenes.lock.json`,
  ];
  if (mode === "pull") {
    await pullLakes(bucket, region);
    for (const id of ids)
      for (const key of files(id)) await download(bucket, region, key);
  } else if (mode === "push") {
    for (const id of ids)
      for (const key of files(id)) await upload(bucket, region, key);
  } else if (mode === "push-inputs") {
    const file = lakesFile(region);
    if (!existsSync(file)) throw new Error(`${file} is missing: run lakes`);
    await r2Client().send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: `inputs/${region}/lakes.geojson`,
        Body: await readFile(file),
      }),
    );
    console.log(`uploaded inputs/${region}/lakes.geojson`);
  } else {
    await pullLakes(bucket, region);
    let token: string | undefined;
    const prefix = `flow-water/${region}/out/`;
    do {
      const page = await r2Client().send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          ContinuationToken: token,
        }),
      );
      for (const item of page.Contents ?? []) {
        if (!item.Key) continue;
        const key = item.Key.slice(`flow-water/${region}/`.length);
        await download(bucket, region, key, false);
        const id = key.match(/^out\/([a-z0-9-]+)\.report\.json$/)?.[1];
        // inputsHash reads the scene lock; the Python step recomputes it
        if (id) await download(bucket, region, `cache/${id}/scenes.lock.json`);
      }
      token = page.NextContinuationToken;
    } while (token);
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
