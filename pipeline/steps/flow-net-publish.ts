/**
 * pipeline:flow-net-publish — publishes the finished flow-net/1 networks of pipeline:flow-water
 * (F2) as compact flow-net-pub/1 files for the F3 particle engine.
 *
 * 1. Candidates: the sections of data/work/<id>/flow-water/report.json with an inputsHash and no
 *    error; each out/<sectionId>.net.json is parsed with flowNetSchema.
 * 2. QA gate (regions/<id>/flow-net-publish.config.json): schema, no cycles, attribution text,
 *    sources/sinks/shares/orphans of the graph, course coverage (wet, reservoirs, or the net linking the
 *    section's ends along its main arm), and a section in
 *    public/flow/<id>/index.json that is not narrow or noDischarge. A rejected section gets a
 *    reason in the report; the app falls back to the F1 track for it.
 * 3. Output: public/flow/<id>/<sectionId>.net.json and nets.json (ids, reservoirSections), in
 *    the flat folder that next.config.ts hashes. Stale *.net.json are removed; nothing else is.
 *    The 4 MB budget is checked before anything is written. Compact JSON, fixed key order: two
 *    runs give the same bytes.
 * 4. data/work/<id>/flow-net-publish/report.json.
 */
import { existsSync } from "node:fs";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { z } from "zod";
import { flowIndexSchema } from "../../lib/flow/schema";
import { flowNetSchema, type FlowNet } from "../../lib/flow/net-schema";
import {
  flowNetPubSchema,
  type FlowNetPub,
} from "../../lib/flow/net-pub-schema";
import { decodeNet, encodeNet, maxDecodeErrorM } from "../../lib/flow/net-pub";
import { regionFile, rel, REGION_ID, ROOT, workPath } from "../lib/paths";
import { writeReport } from "../lib/report";
import { endsLinked, startNodes, type LinkedPath } from "../lib/net-gate";

const configSchema = z.strictObject({
  $comment: z.string().optional(),
  shareTol: z.number().positive(),
  minWetCourseCoverage: z.number().min(0).max(1),
  endsLinked: z.strictObject({
    endTolM: z.number().nonnegative(),
    minInsideWater: z.number().min(0).max(1),
    maxConnectorShare: z.number().min(0).max(1),
    minPathRatio: z.number().min(0).max(1),
  }),
  maxTotalBytes: z.number().int().positive(),
});

const REQUIRED_ATTRIBUTION = [
  "Contains modified Copernicus Sentinel data",
  "Copernicus WorldDEM-30",
];

/** Length of the union of the intervals, m. */
function unionLength(ranges: [number, number][]): number {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  let total = 0;
  let end = -Infinity;
  for (const [a, b] of sorted) {
    const start = Math.max(a, end);
    if (b > start) total += b - start;
    end = Math.max(end, b);
  }
  return total;
}

/** Reasons the net fails the graph checks (empty = passes). */
function graphReasons(net: FlowNet, shareTol: number): string[] {
  const reasons: string[] = [];
  if (net.branches.length === 0) return reasons;
  const out = new Map<string, number[]>();
  net.branches.forEach((b, i) => {
    const l = out.get(b.from) ?? [];
    l.push(i);
    out.set(b.from, l);
  });
  const starts = startNodes(net);
  if (starts.length === 0) reasons.push("no source or reservoir outlet");
  if (!net.nodes.some((n) => n.kind === "sink") && net.reservoirs.length === 0)
    reasons.push("no sink or reservoir");
  for (const [node, list] of out) {
    if (list.length < 2) continue;
    const sum = list.reduce((s, i) => s + net.branches[i]!.share, 0);
    if (Math.abs(sum - 1) > shareTol)
      reasons.push(`shares at ${node} sum to ${sum.toFixed(4)}`);
  }
  const seen = new Set<string>(starts.map((n) => n.id));
  const queue = [...seen];
  while (queue.length) {
    for (const i of out.get(queue.pop()!) ?? []) {
      const to = net.branches[i]!.to;
      if (!seen.has(to)) {
        seen.add(to);
        queue.push(to);
      }
    }
  }
  const orphans = net.branches.filter((b) => !seen.has(b.from)).length;
  if (orphans > 0) reasons.push(`${orphans} orphan branches`);
  return reasons;
}

const json = (v: unknown) => JSON.stringify(v);

async function writeAtomic(file: string, data: string) {
  const tmp = `${file}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, file);
}

async function main() {
  const configFile = regionFile("flow-net-publish.config.json");
  if (!existsSync(configFile))
    throw new Error(
      `${rel(configFile)} is missing: flow-net-publish is not configured for region ${REGION_ID}`,
    );
  const config = configSchema.parse(
    JSON.parse(await readFile(configFile, "utf8")),
  );
  const waterDir = workPath("flow-water");
  const reportFile = path.join(waterDir, "report.json");
  if (!existsSync(reportFile))
    throw new Error(`${rel(reportFile)} is missing: run pipeline:flow-water`);
  const water = JSON.parse(await readFile(reportFile, "utf8")) as {
    sections: Record<string, { inputsHash?: string; error?: unknown }>;
  };
  const pubDir = path.join(ROOT, "public/flow", REGION_ID);
  const indexFile = path.join(pubDir, "index.json");
  if (!existsSync(indexFile))
    throw new Error(`${rel(indexFile)} is missing: run pipeline:flow-sections`);
  const index = flowIndexSchema.parse(
    JSON.parse(await readFile(indexFile, "utf8")),
  );
  const indexReason = new Map(
    index.rivers.flatMap((r) => r.sections.map((s) => [s.id, s.reason])),
  );

  const candidates = Object.entries(water.sections)
    .filter(([, s]) => s.inputsHash && !s.error)
    .map(([id]) => id)
    .sort();

  const published: {
    id: string;
    text: string;
    net: FlowNet;
    pub: FlowNetPub;
    coverageBy: "wet" | "reservoirs" | "endsLinked";
    linkedPath: LinkedPath | null;
  }[] = [];
  const rejected: { id: string; reasons: string[] }[] = [];
  let maxErrM = 0;
  for (const id of candidates) {
    const file = path.join(waterDir, "out", `${id}.net.json`);
    const reasons: string[] = [];
    let net: FlowNet | null = null;
    let coverageBy: "wet" | "reservoirs" | "endsLinked" = "wet";
    let linkedPath: LinkedPath | null = null;
    if (!existsSync(file)) reasons.push("net.json missing");
    else {
      const parsed = flowNetSchema.safeParse(
        JSON.parse(await readFile(file, "utf8")),
      );
      if (!parsed.success) reasons.push("flow-net/1 schema invalid");
      else net = parsed.data;
    }
    if (net) {
      if (net.id !== id || net.region !== REGION_ID)
        reasons.push("id or region does not match");
      if (net.qa.cycles !== 0) reasons.push(`${net.qa.cycles} cycles`);
      for (const part of REQUIRED_ATTRIBUTION)
        if (!net.source.attribution.includes(part))
          reasons.push(`attribution lacks "${part}"`);
      reasons.push(...graphReasons(net, config.shareTol));
      const wet = net.qa.wetCourseCoverage;
      const resCover =
        net.courseLengthM > 0
          ? unionLength(
              net.reservoirs.flatMap((r) => (r.sRange ? [r.sRange] : [])),
            ) / net.courseLengthM
          : 0;
      if (wet !== null && wet >= config.minWetCourseCoverage) {
        coverageBy = "wet";
      } else if (resCover >= config.minWetCourseCoverage) {
        coverageBy = "reservoirs";
      } else {
        const linked = endsLinked(net, config.endsLinked);
        if (linked.linked) {
          coverageBy = "endsLinked";
          linkedPath = linked.path;
        } else
          reasons.push(
            `coverage: wet ${wet ?? "null"}, reservoirs ${resCover.toFixed(3)} < ${config.minWetCourseCoverage}; endsLinked: ${linked.reason}`,
          );
      }
    }
    if (!indexReason.has(id)) reasons.push("not in index.json");
    else {
      const r = indexReason.get(id);
      if (r === "narrow" || r === "noDischarge")
        reasons.push(`index reason ${r}`);
    }
    if (reasons.length || !net) {
      rejected.push({ id, reasons });
      continue;
    }
    const pub = flowNetPubSchema.parse(encodeNet(net));
    maxErrM = Math.max(maxErrM, maxDecodeErrorM(net, decodeNet(pub)));
    published.push({ id, text: json(pub), net, pub, coverageBy, linkedPath });
  }

  const ids = published.map((p) => p.id);
  const reservoirSections = published
    .filter(
      (p) =>
        indexReason.get(p.id) === "reservoir" && p.net.reservoirs.length > 0,
    )
    .map((p) => p.id);
  const manifest = json({ region: REGION_ID, ids, reservoirSections }) + "\n";
  const perSection = published.map((p) => ({
    id: p.id,
    coverageBy: p.coverageBy,
    ...(p.linkedPath ? { linkedPath: p.linkedPath } : {}),
    bytes: Buffer.byteLength(p.text),
    gzipBytes: gzipSync(p.text).length,
    netBytes: Buffer.byteLength(json(p.net)),
  }));
  const bytes =
    perSection.reduce((s, p) => s + p.bytes, 0) + Buffer.byteLength(manifest);
  const withinBudget = bytes <= config.maxTotalBytes;
  const rejectedByReason: Record<string, number> = {};
  for (const r of rejected)
    for (const reason of r.reasons) {
      const key = reason.replace(/[\d.]+/g, "#");
      rejectedByReason[key] = (rejectedByReason[key] ?? 0) + 1;
    }
  const checks = { withinBudget, maxDecodeErrorUnder1m: maxErrM < 1 };
  const ok = Object.values(checks).every(Boolean);

  if (ok) {
    await mkdir(pubDir, { recursive: true });
    for (const f of await readdir(pubDir))
      if (f.endsWith(".net.json") && !ids.includes(f.slice(0, -9)))
        await rm(path.join(pubDir, f));
    for (const p of published)
      await writeAtomic(path.join(pubDir, `${p.id}.net.json`), p.text);
    await writeAtomic(path.join(pubDir, "nets.json"), manifest);
  }
  await writeReport("flow-net-publish", {
    ok,
    checks,
    candidates: candidates.length,
    published: published.length,
    publishedByEndsLinked: published.filter(
      (p) => p.coverageBy === "endsLinked",
    ).length,
    rejected: rejected.length,
    rejectedByReason,
    bytes,
    maxTotalBytes: config.maxTotalBytes,
    maxDecodeErrorM: Math.round(maxErrM * 1000) / 1000,
    attribution: published[0]?.net.source.attribution ?? null,
    perSection,
    rejectedSections: rejected,
    reservoirSections,
    config,
    outputs: [rel(pubDir)],
  });
  if (!ok) {
    const failed = Object.entries(checks).filter(([, v]) => !v);
    throw new Error(
      `flow-net-publish checks failed: ${JSON.stringify(Object.fromEntries(failed))}`,
    );
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
