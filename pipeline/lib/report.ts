import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { rel, workPath } from "./paths";

/**
 * Write `data/work/<step>/report.json`. Every step ends with one (CLAUDE.md rule 7);
 * verify results by reading it, not by eye.
 */
export async function writeReport(
  step: string,
  body: Record<string, unknown>,
): Promise<string> {
  const file = workPath(step, "report.json");
  await mkdir(path.dirname(file), { recursive: true });
  const report = { step, generatedAt: new Date().toISOString(), ...body };
  await writeFile(file, JSON.stringify(report, null, 2) + "\n");
  console.log(`report: ${rel(file)}`);
  return file;
}
