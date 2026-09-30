/**
 * Copy MapLibre's worker modules into public/maplibre/<version>/.
 *
 * maplibre-gl 6 starts its web worker from a separate ES module
 * (maplibre-gl-worker.mjs, which imports ./maplibre-gl-shared.mjs) and finds it
 * relative to its own URL, which does not survive bundling. The app serves both files
 * as static assets and points setWorkerUrl at them (lib/map/worker.ts). Runs before
 * `dev` and `build`; the output is gitignored.
 */
import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIST = path.join(ROOT, "node_modules/maplibre-gl/dist");
const FILES = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

async function main() {
  const { version } = JSON.parse(
    await readFile(
      path.join(ROOT, "node_modules/maplibre-gl/package.json"),
      "utf8",
    ),
  ) as { version: string };
  const outRoot = path.join(ROOT, "public/maplibre");
  await rm(outRoot, { recursive: true, force: true });
  const out = path.join(outRoot, version);
  await mkdir(out, { recursive: true });
  for (const f of FILES) await copyFile(path.join(DIST, f), path.join(out, f));
  console.log(`maplibre worker ${version} → ${path.relative(ROOT, out)}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
