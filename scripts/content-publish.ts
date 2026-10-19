/** Publish immutable, content-addressed public output to the R2 content bucket. */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { contentVersion } from "../lib/content-hash";
import {
  contentArgs,
  contentBucket,
  type ContentVersions,
  immutable,
  listFiles,
  objectExists,
  putFile,
} from "./content-lib";

async function main() {
  const { region, kinds } = contentArgs();
  const bucket = contentBucket();
  const root = process.cwd();
  const manifestFile = path.join(root, "content", "versions.json");
  const manifest = JSON.parse(
    await readFile(manifestFile, "utf8"),
  ) as ContentVersions;
  const report: Record<string, unknown> = {
    region,
    files: 0,
    bytes: 0,
    uploaded: 0,
    skipped: 0,
    kinds: {},
  };

  for (const kind of kinds) {
    const dir = path.join(root, "public", kind, region);
    const version = contentVersion(
      dir,
      kind === "tiles" ? ".pmtiles" : ".json",
    );
    if (!version) throw new Error(`No ${kind} output found in ${dir}`);
    const names = await listFiles(dir, kind);
    if (!names.length) throw new Error(`No ${kind} files found in ${dir}`);
    let uploaded = 0;
    let skipped = 0;
    let bytes = 0;
    for (const name of names) {
      const file = path.join(dir, name);
      const body = await readFile(file);
      const key = `${kind}/${region}/${version}/${name}`;
      bytes += body.length;
      if (await objectExists(bucket, key)) skipped++;
      else {
        await putFile(bucket, key, body);
        uploaded++;
      }
    }
    manifest[kind] ??= {};
    manifest[kind][region] = version;
    report.files = Number(report.files) + uploaded + skipped;
    report.bytes = Number(report.bytes) + bytes;
    report.uploaded = Number(report.uploaded) + uploaded;
    report.skipped = Number(report.skipped) + skipped;
    (report.kinds as Record<string, unknown>)[kind] = {
      version,
      uploaded,
      skipped,
      bytes,
      cacheControl: immutable,
    };
  }
  await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + "\n");
  const reportDir = path.join(root, "data", "work", region, "content-publish");
  await import("node:fs/promises").then(({ mkdir }) =>
    mkdir(reportDir, { recursive: true }),
  );
  await writeFile(
    path.join(reportDir, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
