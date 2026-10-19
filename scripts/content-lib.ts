import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { KNOWN_REGION_IDS } from "../regions/index";
import { KIND_EXT, type ContentKind } from "../lib/content-hash";
import { r2Client, r2Env } from "./lib/r2";

export type ContentVersions = Record<ContentKind, Record<string, string>>;
export const KINDS: ContentKind[] = ["tiles", "flow"];
export const immutable = "public, max-age=31536000, immutable";

export function contentArgs(argv = process.argv.slice(2)) {
  const value = (name: string) => {
    const at = argv.findIndex((a) => a === name || a.startsWith(`${name}=`));
    if (at < 0) return undefined;
    const arg = argv[at]!;
    return arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : argv[at + 1];
  };
  const region = value("--region");
  if (!region) throw new Error("--region is required");
  if (!(KNOWN_REGION_IDS as readonly string[]).includes(region))
    throw new Error(
      `unknown region ${region}; known: ${KNOWN_REGION_IDS.join(", ")}`,
    );
  const kind = value("--kind");
  if (kind && !KINDS.includes(kind as ContentKind))
    throw new Error("--kind must be tiles or flow");
  return { region, kinds: kind ? [kind as ContentKind] : KINDS };
}

export function contentBucket() {
  return r2Env("R2_CONTENT_BUCKET").bucket;
}

export async function listFiles(dir: string, kind: ContentKind) {
  return (await readdir(dir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(KIND_EXT[kind]))
    .map((entry) => entry.name)
    .sort();
}

export async function objectExists(bucket: string, key: string) {
  try {
    await r2Client().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (error: unknown) {
    if (typeof error === "object" && error && "$metadata" in error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } })
        .$metadata?.httpStatusCode;
      if (status === 404) return false;
    }
    throw error;
  }
}

export async function putFile(bucket: string, key: string, body: Uint8Array) {
  await r2Client().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      CacheControl: immutable,
    }),
  );
}

export async function pullPrefix(
  bucket: string,
  prefix: string,
  destination: string,
) {
  const client = r2Client();
  const { ListObjectsV2Command } = await import("@aws-sdk/client-s3");
  let token: string | undefined;
  let files = 0;
  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    for (const object of page.Contents ?? []) {
      if (!object.Key || object.Key.endsWith("/")) continue;
      const name = object.Key.slice(prefix.length);
      if (!name || name.includes("/")) continue;
      const response = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: object.Key }),
      );
      await mkdir(destination, { recursive: true });
      await writeFile(
        path.join(destination, name),
        await response.Body!.transformToByteArray(),
      );
      files++;
    }
    token = page.NextContinuationToken;
  } while (token);
  return files;
}

export async function emptyContentDir(dir: string) {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
}
