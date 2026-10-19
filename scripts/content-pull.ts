/** Restore one published content version into public/ for a fresh clone or CI runner. */
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  contentArgs,
  contentBucket,
  emptyContentDir,
  pullPrefix,
  type ContentVersions,
} from "./content-lib";

async function main() {
  const { region, kinds } = contentArgs();
  const root = process.cwd();
  const manifest = JSON.parse(
    await readFile(path.join(root, "content", "versions.json"), "utf8"),
  ) as ContentVersions;
  const bucket = contentBucket();
  for (const kind of kinds) {
    const version = manifest[kind]?.[region];
    if (!version) throw new Error(`No published ${kind} version for ${region}`);
    const dest = path.join(root, "public", kind, region);
    await emptyContentDir(dest);
    const files = await pullPrefix(
      bucket,
      `${kind}/${region}/${version}/`,
      dest,
    );
    if (!files)
      throw new Error(`R2 prefix ${kind}/${region}/${version}/ is empty`);
    console.log(`${kind}/${region}: ${files} files (${version})`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
