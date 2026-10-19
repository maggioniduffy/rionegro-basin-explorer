/** Expand flow-water selection exactly as its Python CLI does, then make dispatch chunks. */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { chunkIds, selectIds } from "./lib/flow-water-select";

function arg(name: string) {
  const at = process.argv.findIndex(
    (value) => value === name || value.startsWith(`${name}=`),
  );
  if (at < 0) return undefined;
  const value = process.argv[at]!;
  return value.includes("=")
    ? value.slice(value.indexOf("=") + 1)
    : process.argv[at + 1];
}

async function plan(
  region: string,
  only: string | undefined,
  rivers: string | undefined,
  chunk: number,
) {
  const index = JSON.parse(
    await readFile(
      path.join(process.cwd(), "public", "flow", region, "index.json"),
      "utf8",
    ),
  ) as {
    rivers: { slug: string; sections: { id: string; index: number }[] }[];
  };
  const entries = index.rivers.flatMap((river) =>
    river.sections.map((section) => ({ ...section, river: river.slug })),
  );
  return chunkIds(selectIds(entries, only, rivers), chunk);
}

async function main() {
  const region = arg("--region");
  if (!region) throw new Error("--region is required");
  const chunk = Number(arg("--chunk"));
  if (!Number.isInteger(chunk) || chunk < 1)
    throw new Error("--chunk must be a positive integer");
  console.log(
    JSON.stringify(await plan(region, arg("--only"), arg("--rivers"), chunk)),
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
