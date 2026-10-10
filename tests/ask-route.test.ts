import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Catalog } from "@/lib/ask/catalog";
import type { AskResult } from "@/lib/ask/contract";
import type { Intent } from "@/lib/ask/intent";
import type { CatalogDocs } from "@/lib/data/queries";

vi.mock("server-only", () => ({}));

const IP = "203.0.113.77";

// A catalog from the real seeded names (data/out is what `npm run seed` loads).
const ndjson = (file: string) =>
  readFileSync(`data/out/${file}.ndjson`, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as unknown);
const docs = {
  rivers: ndjson("rivers"),
  subbasins: ndjson("subbasins"),
  streams: ndjson("streams"),
} as CatalogDocs;

const { buildCatalog } = await import("@/lib/ask/catalog");
const catalog: Catalog = buildCatalog(docs);
vi.mock("@/lib/ask/catalog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ask/catalog")>()),
  getCatalog: async () => {
    if (catalogFailure.on) throw new TypeError(`no catalog for ${IP}`);
    return catalog;
  },
}));

const catalogFailure = vi.hoisted(() => ({ on: false }));
const llm = vi.hoisted(() => ({
  enabled: true,
  resolveIntent: vi.fn(),
}));
vi.mock("@/lib/llm", () => ({
  isLlmEnabled: () => llm.enabled,
  resolveIntent: llm.resolveIntent,
}));

// In-memory stand-ins for Upstash: one key-value store, sliding windows as counters.
const upstash = vi.hoisted(() => ({
  kv: new Map<string, unknown>(),
  counts: new Map<string, number>(),
  failRedis: false,
}));
vi.mock("@upstash/redis", () => ({
  Redis: class {
    async get(key: string) {
      if (upstash.failRedis) throw new Error("redis down");
      return upstash.kv.get(key) ?? null;
    }
    async set(key: string, value: unknown) {
      if (upstash.failRedis) throw new Error("redis down");
      upstash.kv.set(key, value);
      return "OK";
    }
  },
}));
vi.mock("@upstash/ratelimit", () => ({
  Ratelimit: class {
    static slidingWindow(tokens: number, window: string) {
      return { tokens, window };
    }
    constructor(
      private readonly config: {
        prefix: string;
        limiter: { tokens: number };
      },
    ) {}
    async limit(id: string) {
      if (upstash.failRedis) throw new Error("redis down");
      const key = `${this.config.prefix}:${id}`;
      const n = (upstash.counts.get(key) ?? 0) + 1;
      upstash.counts.set(key, n);
      return {
        success: n <= this.config.limiter.tokens,
        reset: Date.now() + 42_000,
      };
    }
  },
}));

const SECRET_QUESTIONS = new Set<string>();

function post(
  q: unknown,
  opts: { locale?: string; ip?: string; raw?: string } = {},
) {
  if (typeof q === "string") SECRET_QUESTIONS.add(q);
  return new Request("http://localhost/api/ask", {
    method: "POST",
    headers: { "x-forwarded-for": `${opts.ip ?? IP}, 10.0.0.1` },
    body: opts.raw ?? JSON.stringify({ q, locale: opts.locale ?? "es" }),
  });
}

async function setup() {
  vi.resetModules();
  return (await import("@/app/api/ask/route")).POST;
}

async function ask(
  POST: Awaited<ReturnType<typeof setup>>,
  q: string,
  opts?: Parameters<typeof post>[1],
) {
  const res = await POST(post(q, opts));
  expect(res.status).toBe(200);
  expect(res.headers.get("Cache-Control")).toBe("no-store");
  return (await res.json()) as AskResult;
}

let spies: Array<ReturnType<typeof vi.spyOn>>;

beforeEach(() => {
  upstash.kv.clear();
  upstash.counts.clear();
  upstash.failRedis = false;
  llm.enabled = true;
  catalogFailure.on = false;
  llm.resolveIntent.mockReset();
  llm.resolveIntent.mockResolvedValue({ action: "unsupported" } as Intent);
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "token");
  vi.stubEnv("ASK_IP_SALT", "a-salt-of-at-least-16-chars");
  SECRET_QUESTIONS.clear();
  spies = (["log", "warn", "error", "info"] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => {}),
  );
});

afterEach(() => {
  // Neither the question nor the client address may reach any log line.
  const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls));
  expect(logged).not.toContain(IP);
  for (const q of SECRET_QUESTIONS) {
    if (q.length > 0) expect(logged).not.toContain(q);
  }
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/ask: fuzzy", () => {
  it("opens a typed name without calling the LLM", async () => {
    const POST = await setup();
    expect(await ask(POST, "collon cura")).toEqual({
      action: "select",
      kind: "river",
      id: "collon-cura",
      source: "fuzzy",
    });
    expect(await ask(POST, "Rio Neuquen")).toMatchObject({
      action: "select",
      kind: "river",
      id: "neuquen",
      source: "fuzzy",
    });
    expect(llm.resolveIntent).not.toHaveBeenCalled();
  });

  it("prefers the sub-basin when the question says basin", async () => {
    const POST = await setup();
    expect(await ask(POST, "subcuenca del neuquen")).toEqual({
      action: "select",
      kind: "subbasin",
      id: "neuquen",
      source: "fuzzy",
    });
    expect(llm.resolveIntent).not.toHaveBeenCalled();
  });

  it("still answers fuzzy matches when Upstash is not configured", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    const POST = await setup();
    expect(await ask(POST, "limay")).toMatchObject({
      action: "select",
      id: "limay",
      source: "fuzzy",
    });
    expect(llm.resolveIntent).not.toHaveBeenCalled();
  });
});

describe("POST /api/ask: LLM", () => {
  const sentence = "cual es el rio que desemboca en el atlantico";

  it("calls the LLM once for a sentence and serves repeats from cache", async () => {
    llm.resolveIntent.mockResolvedValue({
      action: "select_river",
      slug: "negro",
    } satisfies Intent);
    const POST = await setup();
    expect(await ask(POST, sentence)).toEqual({
      action: "select",
      kind: "river",
      id: "negro",
      source: "llm",
    });
    expect(await ask(POST, sentence)).toEqual({
      action: "select",
      kind: "river",
      id: "negro",
      source: "cache",
    });
    expect(llm.resolveIntent).toHaveBeenCalledTimes(1);
    const [query, locale] = llm.resolveIntent.mock.calls[0] ?? [];
    expect(query).toBe("cual es el rio que desemboca en el atlantico");
    expect(locale).toBe("es");
  });

  it("does not cache an LLM unsupported (it may be a timeout)", async () => {
    llm.resolveIntent.mockResolvedValue({ action: "unsupported" });
    const POST = await setup();
    expect(await ask(POST, sentence)).toMatchObject({ source: "llm" });
    expect(await ask(POST, sentence)).toMatchObject({ source: "llm" });
    expect(llm.resolveIntent).toHaveBeenCalledTimes(2);
  });

  it("shares the cache across instances through Redis", async () => {
    llm.resolveIntent.mockResolvedValue({
      action: "select_subbasin",
      slug: "limay",
    } satisfies Intent);
    let POST = await setup();
    await ask(POST, sentence);
    expect([...upstash.kv.keys()][0]).toMatch(/^ask:v1:/);
    POST = await setup(); // a cold instance: empty memory tier
    expect(await ask(POST, sentence)).toMatchObject({
      kind: "subbasin",
      id: "limay",
      source: "cache",
    });
    expect(llm.resolveIntent).toHaveBeenCalledTimes(1);
  });

  it("ignores a Redis value that is not an answer", async () => {
    const POST = await setup();
    await ask(POST, sentence);
    for (const key of upstash.kv.keys()) upstash.kv.set(key, { id: 1 });
    const again = await setup();
    expect(await ask(again, sentence)).toMatchObject({ source: "llm" });
  });

  it("opens the top fuzzy match of a search intent, only if it is a real name", async () => {
    const POST = await setup();
    llm.resolveIntent.mockResolvedValueOnce({
      action: "search",
      query: "limai",
    } satisfies Intent);
    expect(await ask(POST, "ese rio grande de la patagonia norte")).toEqual({
      action: "select",
      kind: "river",
      id: "limay",
      source: "llm",
    });
    llm.resolveIntent.mockResolvedValueOnce({
      action: "search",
      query: "zxqvbnmwk",
    } satisfies Intent);
    expect(await ask(POST, "algo completamente distinto del mapa")).toEqual({
      action: "no_match",
      source: "llm",
    });
  });

  it("only ever returns ids present in the catalog", async () => {
    const POST = await setup();
    const intents: Intent[] = [
      { action: "search", query: "qqqq zzzz" },
      { action: "search", query: "limay" },
      { action: "select_river", slug: "negro" },
      { action: "select_subbasin", slug: "neuquen" },
      { action: "unsupported" },
    ];
    for (const [i, intent] of intents.entries()) {
      llm.resolveIntent.mockResolvedValueOnce(intent);
      const res = await ask(POST, `pregunta numero ${"x".repeat(i + 3)} larga`);
      if (res.action === "select") {
        expect(
          catalog.entries.some((e) => e.kind === res.kind && e.id === res.id),
        ).toBe(true);
      }
    }
  });

  it("is unsupported, with no LLM call, when the LLM is off", async () => {
    llm.enabled = false;
    const POST = await setup();
    expect(await ask(POST, sentence)).toEqual({
      action: "unsupported",
      source: "fuzzy",
    });
    expect(llm.resolveIntent).not.toHaveBeenCalled();
    expect(upstash.kv.size).toBe(0);
  });

  it("does not call the LLM without Upstash (fails closed)", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    const POST = await setup();
    expect(await ask(POST, sentence)).toEqual({
      action: "unsupported",
      source: "fuzzy",
    });
    expect(llm.resolveIntent).not.toHaveBeenCalled();
  });

  it("does not call the LLM when Redis errors, and does not cache that", async () => {
    upstash.failRedis = true;
    const POST = await setup();
    expect(await ask(POST, sentence)).toMatchObject({
      action: "unsupported",
      source: "fuzzy",
    });
    expect(llm.resolveIntent).not.toHaveBeenCalled();
    upstash.failRedis = false;
    llm.resolveIntent.mockResolvedValue({ action: "search", query: "zzzzzz" });
    expect(await ask(POST, sentence)).toMatchObject({
      action: "no_match",
      source: "llm",
    });
  });

  it("does not call the LLM without the IP salt", async () => {
    vi.stubEnv("ASK_IP_SALT", "");
    const POST = await setup();
    expect(await ask(POST, sentence)).toMatchObject({ action: "unsupported" });
    expect(llm.resolveIntent).not.toHaveBeenCalled();
  });
});

describe("POST /api/ask: rate limit", () => {
  it("answers the 11th request in a minute with 429 and Retry-After", async () => {
    const POST = await setup();
    for (let i = 0; i < 10; i++) {
      expect((await POST(post("limay"))).status).toBe(200);
    }
    const res = await POST(post("limay"));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate_limited" });
    expect(res.headers.get("Retry-After")).toBe("42");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    // Another client is unaffected.
    expect((await POST(post("limay", { ip: "198.51.100.5" }))).status).toBe(
      200,
    );
  });

  it("stores no raw IP in Upstash keys", async () => {
    const POST = await setup();
    await POST(post("limay"));
    const keys = [...upstash.counts.keys(), ...upstash.kv.keys()].join(" ");
    expect(keys).not.toContain(IP);
    expect(keys).toContain("ask:rl:");
  });
});

describe("POST /api/ask: failures", () => {
  it("answers 500 and logs only the error name", async () => {
    catalogFailure.on = true;
    const POST = await setup();
    const res = await POST(post("limay"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "server_error" });
    expect(console.error).toHaveBeenCalledWith("api/ask failed", "TypeError");
  });
});

describe("POST /api/ask: bad requests", () => {
  it.each([
    ["not JSON", { raw: "{nope" }],
    ["no q", { raw: JSON.stringify({ locale: "en" }) }],
    ["q not a string", { raw: JSON.stringify({ q: 3, locale: "en" }) }],
    ["unknown locale", { raw: JSON.stringify({ q: "limay", locale: "fr" }) }],
    [
      "nothing left after normalizing",
      { raw: JSON.stringify({ q: "?!", locale: "en" }) },
    ],
    [
      "q too long",
      { raw: JSON.stringify({ q: "a".repeat(121), locale: "en" }) },
    ],
  ])("%s → 400", async (_name, opts) => {
    const POST = await setup();
    const res = await POST(post("", opts));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_request" });
    expect(llm.resolveIntent).not.toHaveBeenCalled();
  });
});
