/**
 * Content hash of a region's published files (tiles or flow sections). Shared by next.config.ts
 * (build-time versions) and the content:publish / content:pull scripts, so all three agree on
 * what a version is. Node built-ins only and no "@/..." aliases: next.config.ts cannot resolve them.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type ContentKind = "tiles" | "flow";

export const KIND_EXT: Record<ContentKind, ".pmtiles" | ".json"> = {
  tiles: ".pmtiles",
  flow: ".json",
};

/**
 * sha256 over each file's name then bytes (names sorted), first 12 hex chars. Null when the
 * directory does not exist. Other extensions are ignored.
 */
export function contentVersion(
  dir: string,
  ext: ".pmtiles" | ".json",
): string | null {
  if (!existsSync(dir)) return null;
  const hash = createHash("sha256");
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith(ext)) continue;
    hash.update(file).update(readFileSync(join(dir, file)));
  }
  return hash.digest("hex").slice(0, 12);
}

/** Versions of every region folder under <root>/<kind>/ (root defaults to the repo's public/). */
export function localVersions(
  kind: ContentKind,
  root = join(process.cwd(), "public"),
): Record<string, string> {
  const base = join(root, kind);
  const versions: Record<string, string> = {};
  if (!existsSync(base)) return versions;
  for (const region of readdirSync(base, { withFileTypes: true })) {
    if (!region.isDirectory()) continue;
    const v = contentVersion(join(base, region.name), KIND_EXT[kind]);
    if (v) versions[region.name] = v;
  }
  return versions;
}
