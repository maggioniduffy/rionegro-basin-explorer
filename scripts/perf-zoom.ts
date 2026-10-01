/**
 * perf:zoom — repeatable zoom/pan benchmark for the map.
 *
 * Builds the app with NEXT_PUBLIC_E2E=1 (exposes window.__map), serves it with
 * `next start`, opens it in a fresh Chromium profile (no extensions, no throttling)
 * and runs a scripted sequence per run:
 *   wheel  — wheel zoom in and out at the cursor (real input handlers)
 *   drag   — mouse-drag pans (fires the map's mousemove handlers)
 *   ease   — easeTo / flyTo zooms and pans through window.__map
 * Each segment is recorded from its first input until the map is idle again, so tile
 * loading after the gesture counts. Every measured run reloads the page, so tiles are
 * decoded each time (the HTTP cache stays warm).
 *
 * Metrics per segment: frame times from requestAnimationFrame deltas (avg, p95,
 * % over 16.7 ms, jank ms = Σ(delta − 16.7) over long frames) and main-thread
 * scripting ms (CDP Performance.getMetrics ScriptDuration delta). The first measured
 * run also writes a Chrome trace to data/work/perf/<label>.trace.json.
 *
 *   npm run perf:zoom -- [--label name] [--out path] [--runs 3] [--port 3200]
 *                        [--no-build] [--headless] [--real-imagery]
 *                        [--hide mask,subbasins,rivers,imagery] [--no-hover]
 *                        [--cpu-throttle 4] [--mode api|events] [--url <page>]
 *
 * --mode events uses only real wheel and drag input, with no window.__map: no ease
 * segment, fixed waits instead of the idle signal (settleMs is not measured), and a
 * fixed wait after load. It works on any map page, so --url can point at another site
 * (no build, no server) to get a comparable target. It has more variance than the
 * default mode: the waits don't track tile loading, and other sites load over the
 * network.
 *
 * Headed by default: headless Chromium falls back to SwiftShader (software WebGL),
 * which skews frame times. The output records the WebGL renderer actually used.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { chromium, type CDPSession, type Page } from "@playwright/test";
import { E2E_IMAGERY_HOST, stubImagery } from "../e2e/map-helpers";

const ROOT = path.resolve(import.meta.dirname, "..");
const FRAME_BUDGET_MS = 1000 / 60;
/** rAF deltas jitter around the vsync interval (16.6–16.8 ms); only count real overruns. */
const VSYNC_JITTER_MS = 1;
/** A frame this long means at least one vsync was missed. */
const DROPPED_MS = 1.5 * FRAME_BUDGET_MS;
const VIEWPORT = { width: 1440, height: 900 };

const pause = (page: Page, ms: number) => page.waitForTimeout(ms);

const { values: args } = parseArgs({
  options: {
    label: { type: "string", default: "run" },
    out: { type: "string" },
    runs: { type: "string", default: "3" },
    port: { type: "string", default: "3200" },
    "no-build": { type: "boolean", default: false },
    headless: { type: "boolean", default: false },
    "real-imagery": { type: "boolean", default: false },
    hide: { type: "string", default: "" },
    "no-hover": { type: "boolean", default: false },
    "cpu-throttle": { type: "string", default: "1" },
    mode: { type: "string", default: "api" },
    url: { type: "string" },
  },
});
const port = Number(args.port);
const runs = Number(args.runs);
const cpuThrottle = Number(args["cpu-throttle"]);
const hide = args.hide.split(",").filter(Boolean);
const events = args.mode === "events" || Boolean(args.url);
if (args.mode !== "api" && args.mode !== "events")
  throw new Error(`--mode must be api or events, not ${args.mode}`);
if (events && (hide.length || args["no-hover"]))
  throw new Error("--hide and --no-hover need window.__map (--mode api)");
const pageUrl = args.url ?? `http://localhost:${port}/`;
/** Events mode: wait after load, and after each segment, instead of the idle signal. */
const EVENTS_LOAD_WAIT_MS = 8000;
const EVENTS_SETTLE_MS = 2000;
const outPath = path.resolve(
  ROOT,
  args.out ?? `data/work/perf/${args.label}.json`,
);
const tracePath = path.resolve(ROOT, `data/work/perf/${args.label}.trace.json`);

function run(cmd: string, argv: string[], env: NodeJS.ProcessEnv) {
  return new Promise<void>((resolve, reject) => {
    const p = spawn(cmd, argv, { cwd: ROOT, env, stdio: "inherit" });
    p.on("error", reject);
    p.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`)),
    );
  });
}

function appEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, NEXT_PUBLIC_E2E: "1" };
  // process.env beats .env.local, as in playwright.config.ts.
  if (!args["real-imagery"]) {
    env.NEXT_PUBLIC_IMAGERY_TILE_URL = `${E2E_IMAGERY_HOST}/{z}/{x}/{y}.png`;
    env.NEXT_PUBLIC_IMAGERY_ATTRIBUTION = "E2E imagery";
  }
  return env;
}

async function startServer(): Promise<ChildProcess> {
  const server = spawn("npx", ["next", "start", "-p", String(port)], {
    cwd: ROOT,
    env: appEnv(),
    stdio: ["ignore", "ignore", "inherit"],
    detached: true,
  });
  const url = `http://localhost:${port}/`;
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null)
      throw new Error(
        `next start exited ${server.exitCode} (port ${port} in use?)`,
      );
    try {
      if ((await fetch(url)).ok) return server;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`next start did not answer on ${url}`);
}

/** After a segment: the map's idle signal, or a fixed wait in events mode. */
const settle = (page: Page) =>
  events ? pause(page, EVENTS_SETTLE_MS) : waitIdle(page);

/** After a page load: the map's idle signal, or a fixed wait in events mode. */
async function ready(page: Page) {
  if (!events) return waitIdle(page);
  await page.locator("canvas").first().waitFor({ state: "visible" });
  await pause(page, EVENTS_LOAD_WAIT_MS);
}

async function waitIdle(page: Page) {
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="map"]')
        ?.getAttribute("data-map-idle") === "true" && !window.__map?.isMoving(),
    undefined,
    { timeout: 60_000, polling: 50 },
  );
}

/**
 * Start collecting rAF timestamps in the page. A string, not a function: tsx keeps
 * names of inner functions via a `__name` helper that doesn't exist in the page.
 */
const startFrames = (page: Page) =>
  page.evaluate(`(() => {
    window.__frames = [];
    // A new generation stops any loop left from an earlier segment, which would
    // otherwise keep pushing and double the frame count.
    const gen = (window.__rec = (window.__rec || 0) + 1);
    function tick(t) {
      if (window.__rec !== gen) return;
      window.__frames.push(t);
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  })()`);

const stopFrames = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __rec: number };
    w.__rec += 1;
    return w.__frames;
  });

async function scriptMs(cdp: CDPSession) {
  const { metrics } = await cdp.send("Performance.getMetrics");
  const m = (name: string) => metrics.find((x) => x.name === name)?.value ?? 0;
  return { script: m("ScriptDuration") * 1000, task: m("TaskDuration") * 1000 };
}

interface SegmentStats {
  frames: number;
  durationMs: number;
  avgMs: number;
  p95Ms: number;
  maxMs: number;
  pctOver16_7: number;
  pctDropped: number;
  jankMs: number;
  /** From the end of the input until the map is idle (tiles loaded and drawn). */
  settleMs: number;
  scriptingMs: number;
  taskMs: number;
}

function stats(
  timestamps: number[],
  settleMs: number,
  scriptingMs: number,
  taskMs: number,
): SegmentStats {
  const d = timestamps.slice(1).map((t, i) => t - (timestamps[i] ?? t));
  const sorted = [...d].sort((a, b) => a - b);
  const sum = d.reduce((a, b) => a + b, 0);
  const over = d.filter((x) => x > FRAME_BUDGET_MS + VSYNC_JITTER_MS);
  const dropped = d.filter((x) => x > DROPPED_MS);
  const r = (x: number) => Math.round(x * 10) / 10;
  return {
    frames: d.length,
    durationMs: r(sum),
    avgMs: r(sum / Math.max(d.length, 1)),
    p95Ms: r(sorted[Math.floor(0.95 * (sorted.length - 1))] ?? 0),
    maxMs: r(sorted.at(-1) ?? 0),
    pctOver16_7: r((100 * over.length) / Math.max(d.length, 1)),
    pctDropped: r((100 * dropped.length) / Math.max(d.length, 1)),
    jankMs: r(over.reduce((a, x) => a + x - FRAME_BUDGET_MS, 0)),
    settleMs: r(settleMs),
    scriptingMs: r(scriptingMs),
    taskMs: r(taskMs),
  };
}

async function measure(
  page: Page,
  cdp: CDPSession,
  body: () => Promise<void>,
): Promise<SegmentStats> {
  const before = await scriptMs(cdp);
  await startFrames(page);
  await body();
  const inputDone = performance.now();
  await settle(page);
  // Not measured in events mode: the wait is fixed.
  const settleMs = events ? 0 : performance.now() - inputDone;
  const frames = await stopFrames(page);
  const after = await scriptMs(cdp);
  return stats(
    frames,
    settleMs,
    after.script - before.script,
    after.task - before.task,
  );
}

/** Wheel zoom in, then out, at a point on the Limay–Neuquén confluence side. */
async function wheel(page: Page) {
  await page.mouse.move(VIEWPORT.width * 0.45, VIEWPORT.height * 0.5);
  for (const dy of [-120, 120]) {
    for (let i = 0; i < 24; i++) {
      await page.mouse.wheel(0, dy);
      await pause(page, 30);
    }
    if (events) await pause(page, 1000);
    else
      await page.waitForFunction(() => !window.__map?.isMoving(), undefined, {
        polling: 50,
      });
  }
}

/** Drag-pan in a square (zoomed in first, outside the measurement). */
async function drag(page: Page) {
  const cx = VIEWPORT.width * 0.5;
  const cy = VIEWPORT.height * 0.5;
  for (const [dx, dy] of [
    [400, 0],
    [0, 300],
    [-400, 0],
    [0, -300],
  ] as const) {
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + dx, cy + dy, { steps: 40 });
    await page.mouse.up();
    await pause(page, 100);
  }
}

/** Programmatic camera moves across the basin. */
async function ease(page: Page) {
  const moves = [
    { kind: "flyTo", center: [-68.06, -38.95], zoom: 10 }, // Neuquén confluence
    { kind: "easeTo", center: [-71.0, -40.2], zoom: 9 }, // upper Limay
    { kind: "easeTo", center: [-64.0, -40.6], zoom: 9 }, // lower Río Negro
    { kind: "flyTo", center: [-67.35, -38.84], zoom: 5.5 }, // whole basin
  ] as const;
  for (const m of moves) {
    await page.evaluate(
      ({ kind, center, zoom }) =>
        new Promise<void>((resolve) => {
          const map = window.__map;
          if (!map) return resolve();
          map.once("moveend", () => resolve());
          map[kind]({ center: [center[0], center[1]], zoom, duration: 1500 });
        }),
      m,
    );
  }
}

const ALL_SEGMENTS = { wheel, drag, ease } as const;
const SEGMENTS: Partial<typeof ALL_SEGMENTS> = events
  ? { wheel, drag }
  : ALL_SEGMENTS;
// Setup runs before a segment is measured. Evaluations return nothing: returning the
// Map would make Playwright serialize its whole object graph (a > 1 s stall).
const SETUP: Partial<
  Record<keyof typeof ALL_SEGMENTS, (page: Page) => Promise<void>>
> = {
  drag: async (page) => {
    if (events) {
      // Zoom in with the wheel, as a user would.
      await page.mouse.move(VIEWPORT.width * 0.5, VIEWPORT.height * 0.5);
      for (let i = 0; i < 10; i++) {
        await page.mouse.wheel(0, -120);
        await pause(page, 30);
      }
      await pause(page, EVENTS_SETTLE_MS);
      return;
    }
    await page.evaluate(() => {
      window.__map?.jumpTo({ zoom: 8 });
    });
    await waitIdle(page);
  },
};

type SegmentName = keyof typeof ALL_SEGMENTS | "total";

async function oneRun(
  page: Page,
  cdp: CDPSession,
  trace: boolean,
): Promise<Record<SegmentName, SegmentStats>> {
  await page.reload();
  await ready(page);
  if (args["no-hover"])
    await page.evaluate(() => {
      if (window.__mapHover) window.__map?.off("mousemove", window.__mapHover);
    });
  if (hide.length) {
    await page.evaluate((sources) => {
      const map = window.__map;
      for (const l of map?.getStyle().layers ?? [])
        if ("source" in l && sources.includes(l.source))
          map?.setLayoutProperty(l.id, "visibility", "none");
    }, hide);
    await waitIdle(page);
  }
  const browser = page.context().browser();
  if (trace && browser)
    await browser.startTracing(page, {
      path: tracePath,
      categories: [
        "devtools.timeline",
        "disabled-by-default-devtools.timeline",
        "disabled-by-default-devtools.timeline.frame",
        "v8.execute",
        "disabled-by-default-v8.cpu_profiler",
      ],
    });
  const result: Partial<Record<SegmentName, SegmentStats>> = {};
  const all: SegmentStats[] = [];
  for (const [name, body] of Object.entries(SEGMENTS)) {
    await SETUP[name as keyof typeof ALL_SEGMENTS]?.(page);
    const s = await measure(page, cdp, () => body(page));
    result[name as SegmentName] = s;
    all.push(s);
  }
  if (trace && browser) await browser.stopTracing();
  // Total: frame-weighted averages; p95/max are the worst segment's.
  const frames = all.reduce((a, s) => a + s.frames, 0);
  const sum = (k: keyof SegmentStats) => all.reduce((a, s) => a + s[k], 0);
  const r = (x: number) => Math.round(x * 10) / 10;
  result.total = {
    frames,
    durationMs: r(sum("durationMs")),
    avgMs: r(sum("durationMs") / Math.max(frames, 1)),
    p95Ms: Math.max(...all.map((s) => s.p95Ms)),
    maxMs: Math.max(...all.map((s) => s.maxMs)),
    pctOver16_7: r(
      all.reduce((a, s) => a + s.pctOver16_7 * s.frames, 0) /
        Math.max(frames, 1),
    ),
    pctDropped: r(
      all.reduce((a, s) => a + s.pctDropped * s.frames, 0) /
        Math.max(frames, 1),
    ),
    jankMs: r(sum("jankMs")),
    settleMs: r(sum("settleMs")),
    scriptingMs: r(sum("scriptingMs")),
    taskMs: r(sum("taskMs")),
  };
  return result as Record<SegmentName, SegmentStats>;
}

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}

async function main() {
  const local = !args.url;
  if (local && !args["no-build"]) await run("npm", ["run", "build"], appEnv());
  const server = local ? await startServer() : null;
  const profile = await mkdtemp(path.join(tmpdir(), "perf-zoom-"));
  try {
    const context = await chromium.launchPersistentContext(profile, {
      headless: args.headless,
      viewport: VIEWPORT,
      deviceScaleFactor: 1,
      args: [
        "--disable-extensions",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
        ...(args.headless ? ["--enable-unsafe-swiftshader"] : []),
      ],
    });
    const page = context.pages()[0] ?? (await context.newPage());
    if (local && !args["real-imagery"]) await stubImagery(page);
    const cdp = await context.newCDPSession(page);
    await cdp.send("Performance.enable");
    // Optional: emulate a slower CPU, so main-thread costs show up as dropped frames.
    if (cpuThrottle > 1)
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuThrottle });
    await page.goto(pageUrl);
    await ready(page);
    if (!events && !(await page.evaluate(() => Boolean(window.__map))))
      throw new Error("window.__map missing: build with NEXT_PUBLIC_E2E=1");
    // What the benchmark sees after load, to check no splash or dialog is in the way.
    await page.screenshot({
      path: tracePath.replace(/\.trace\.json$/, ".png"),
    });
    const renderer = await page.evaluate(() => {
      const gl = document.createElement("canvas").getContext("webgl2");
      const ext = gl?.getExtension("WEBGL_debug_renderer_info");
      return ext ? String(gl?.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "?";
    });
    if (/swiftshader|llvmpipe/i.test(renderer))
      console.warn(
        `WARNING: software WebGL (${renderer}); frame times are not representative.`,
      );

    await oneRun(page, cdp, false); // warm-up
    const measured: Record<SegmentName, SegmentStats>[] = [];
    for (let i = 0; i < runs; i++)
      measured.push(await oneRun(page, cdp, i === 0));
    await context.close();

    const segments = Object.keys(measured[0] ?? {}) as SegmentName[];
    const med = Object.fromEntries(
      segments.map((seg) => {
        const keys = Object.keys(
          measured[0]?.[seg] ?? {},
        ) as (keyof SegmentStats)[];
        return [
          seg,
          Object.fromEntries(
            keys.map((k) => [k, median(measured.map((m) => m[seg][k]))]),
          ),
        ];
      }),
    );
    const gitRev = await new Promise<string>((resolve) => {
      let out = "";
      const p = spawn("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT });
      p.stdout.on("data", (d: Buffer) => (out += d.toString()));
      p.on("exit", () => resolve(out.trim()));
    });
    const report = {
      label: args.label,
      generatedAt: new Date().toISOString(),
      gitRev,
      renderer,
      viewport: VIEWPORT,
      options: {
        runs,
        headless: args.headless,
        realImagery: args["real-imagery"],
        hide,
        noHover: args["no-hover"],
        cpuThrottle,
        mode: events ? "events" : "api",
        url: pageUrl,
      },
      median: med,
      runs: measured,
      trace: path.relative(ROOT, tracePath),
    };
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, JSON.stringify(report, null, 2));

    console.log(`\n${args.label} @ ${gitRev} — ${renderer}`);
    console.table(med);
    console.log(`→ ${path.relative(ROOT, outPath)}`);
  } finally {
    if (server?.pid) process.kill(-server.pid, "SIGTERM");
    await rm(profile, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
