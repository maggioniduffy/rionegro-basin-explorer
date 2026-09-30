/**
 * pipeline:download — fetch HydroRIVERS, HydroBASINS and RiverATLAS into data/raw/<id>/.
 *
 * Idempotent: a source whose extracted files carry a checksum matching
 * pipeline/checksums.json is skipped. Archives are deleted after extraction; the
 * committed manifest pins what we used. If upstream re-uploads a file, the run fails;
 * pass --accept-new to record the new checksum after reviewing the change.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { promisify } from "node:util";
import { planDownload } from "../lib/download-plan";
import { CHECKSUMS_FILE, rawPath, rel } from "../lib/paths";
import { writeReport } from "../lib/report";
import { SOURCES, type Source } from "../sources";

const run = promisify(execFile);
const MARKER = ".source.json";
const acceptNew = process.argv.includes("--accept-new");

interface ManifestEntry {
  file: string;
  url: string;
  sha256: string;
  bytes: number;
  downloadedAt: string;
}
type Manifest = Record<string, ManifestEntry>;

async function readJson<T>(file: string): Promise<T | undefined> {
  if (!existsSync(file)) return undefined;
  return JSON.parse(await readFile(file, "utf8")) as T;
}

async function sha256File(file: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(file), hash);
  return hash.digest("hex");
}

/** Stream a URL to disk, hashing as it goes. Writes to `.part` and renames on success. */
async function fetchTo(
  src: Source,
  dest: string,
): Promise<{ sha256: string; bytes: number }> {
  const res = await fetch(src.url, { redirect: "follow" });
  if (!res.ok || !res.body)
    throw new Error(`${src.id}: HTTP ${res.status} for ${src.url}`);
  const total = Number(res.headers.get("content-length")) || src.approxBytes;
  const hash = createHash("sha256");
  let bytes = 0;
  let lastPct = -10;
  const meter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      hash.update(chunk);
      bytes += chunk.length;
      const pct = Math.floor((bytes / total) * 100);
      if (pct >= lastPct + 10) {
        lastPct = pct;
        console.log(`  ${src.id}: ${pct}% (${(bytes / 1e6).toFixed(0)} MB)`);
      }
      cb(null, chunk);
    },
  });
  const part = `${dest}.part`;
  // tsconfig includes the DOM lib, so fetch returns the DOM stream type.
  await pipeline(
    Readable.fromWeb(res.body as NodeReadableStream<Uint8Array>),
    meter,
    createWriteStream(part),
  );
  await rename(part, dest);
  return { sha256: hash.digest("hex"), bytes };
}

async function dirSize(dir: string): Promise<{ files: number; bytes: number }> {
  let files = 0;
  let bytes = 0;
  for (const entry of await readdir(dir, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile() || entry.name === MARKER) continue;
    files += 1;
    bytes += (await stat(path.join(entry.parentPath, entry.name))).size;
  }
  return { files, bytes };
}

async function main() {
  const manifest: Manifest = (await readJson<Manifest>(CHECKSUMS_FILE)) ?? {};
  const results: Record<string, unknown>[] = [];

  for (const src of SOURCES) {
    const dir = rawPath(src.id);
    const archive = path.join(dir, src.file);
    await mkdir(dir, { recursive: true });

    const entry = manifest[src.id];
    const marker = await readJson<{ sha256: string }>(path.join(dir, MARKER));
    const archiveSha = existsSync(archive)
      ? await sha256File(archive)
      : undefined;
    const action = planDownload({
      manifestSha: entry?.sha256,
      extractedSha: marker?.sha256,
      archiveSha,
    });
    console.log(`${src.id}: ${action.kind}`);
    if (action.kind === "error" && !acceptNew) {
      throw new Error(
        `${src.id}: ${action.reason}. Review, then rerun with --accept-new.`,
      );
    }

    let sha256 = marker?.sha256 ?? archiveSha;
    let bytes = entry?.bytes;
    if (
      action.kind === "download" ||
      (action.kind === "error" && !archiveSha)
    ) {
      console.log(
        `  fetching ~${(src.approxBytes / 1e6).toFixed(0)} MB from ${src.url}`,
      );
      ({ sha256, bytes } = await fetchTo(src, archive));
      if (entry && entry.sha256 !== sha256 && !acceptNew) {
        throw new Error(
          `${src.id}: downloaded checksum ${sha256} differs from manifest ${entry.sha256}. ` +
            `Upstream changed the file; review, then rerun with --accept-new.`,
        );
      }
    }
    if (action.kind !== "skip") {
      if (!sha256) throw new Error(`${src.id}: no checksum after download`);
      bytes ??= (await stat(archive)).size;
      console.log(`  extracting ${rel(archive)}`);
      await run("unzip", ["-q", "-o", archive, "-d", dir], {
        maxBuffer: 1 << 24,
      });
      await writeFile(
        path.join(dir, MARKER),
        JSON.stringify({ sha256 }, null, 2) + "\n",
      );
      await rm(archive);
      manifest[src.id] = {
        file: src.file,
        url: src.url,
        sha256,
        bytes,
        downloadedAt:
          entry?.sha256 === sha256
            ? entry.downloadedAt
            : new Date().toISOString().slice(0, 10),
      };
      await writeFile(CHECKSUMS_FILE, JSON.stringify(manifest, null, 2) + "\n");
    }

    const extracted = await dirSize(dir);
    results.push({
      id: src.id,
      action: action.kind,
      sha256: manifest[src.id]?.sha256,
      archiveBytes: manifest[src.id]?.bytes,
      downloadedAt: manifest[src.id]?.downloadedAt,
      extractedFiles: extracted.files,
      extractedBytes: extracted.bytes,
      dir: rel(dir),
    });
  }

  await writeReport("download", { sources: results });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
