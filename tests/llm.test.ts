import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { INTENT_JSON_SCHEMA } from "@/lib/ask/intent";
import type { Catalog } from "@/lib/ask/catalog";

// `server-only` throws outside a react-server bundle; it is only a marker here.
vi.mock("server-only", () => ({}));

const groqCreate = vi.fn();
const groqCtor = vi.fn();
vi.mock("groq-sdk", () => ({
  default: class {
    chat = { completions: { create: groqCreate } };
    constructor(options: unknown) {
      groqCtor(options);
    }
  },
}));

const geminiGenerate = vi.fn();
const geminiCtor = vi.fn();
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: geminiGenerate };
    constructor(options: unknown) {
      geminiCtor(options);
    }
  },
}));

const { isLlmEnabled, resolveIntent } = await import("@/lib/llm");

const catalog = {
  region: "nqn",
  docs: {
    rivers: [
      {
        _id: "limay",
        name: "Río Limay",
        shortName: "Limay",
        aliases: [],
        flowsInto: "negro",
        lengthKm: 1,
        mouth: { uplandKm2: 10 },
      },
      {
        _id: "negro",
        name: "Río Negro",
        shortName: "Negro",
        aliases: [],
        flowsInto: "sea",
        lengthKm: 1,
        mouth: { uplandKm2: 20 },
      },
    ],
    subbasins: [
      {
        _id: "limay",
        kind: "river",
        name: "Limay",
        parentId: "negro",
        river: "limay",
        areaKm2: 1,
      },
    ],
    streams: [],
  },
  known: {
    rivers: new Set(["limay", "negro"]),
    subbasins: new Set(["limay"]),
  },
} as unknown as Catalog;

const SECRET_QUERY = "zzqx secret question about the limay";

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubEnv("LLM_PROVIDER", "groq");
  vi.stubEnv("GROQ_API_KEY", "gsk_test");
  vi.stubEnv("GEMINI_API_KEY", "gem_test");
  vi.stubEnv("LLM_MODEL", "");
  groqCreate.mockReset();
  geminiGenerate.mockReset();
  groqCtor.mockReset();
  geminiCtor.mockReset();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const groqReply = (content: string | null) => ({
  choices: [{ message: { content } }],
});
const json = (o: unknown) => JSON.stringify(o);

describe("isLlmEnabled", () => {
  it("is false when LLM_PROVIDER is unset", () => {
    vi.stubEnv("LLM_PROVIDER", "");
    expect(isLlmEnabled()).toBe(false);
  });
  it("is false when the provider's key is missing", () => {
    vi.stubEnv("GROQ_API_KEY", "");
    expect(isLlmEnabled()).toBe(false);
  });
  it("is true when a provider is configured", () => {
    expect(isLlmEnabled()).toBe(true);
  });
});

describe("resolveIntent with groq", () => {
  it("sends a strict json_schema request with the default model, once", async () => {
    groqCreate.mockResolvedValue(
      groqReply(json({ action: "select_river", slug: "limay", query: null })),
    );
    const intent = await resolveIntent(SECRET_QUERY, "en", catalog);
    expect(intent).toEqual({ action: "select_river", slug: "limay" });
    expect(groqCreate).toHaveBeenCalledTimes(1);
    const [body, options] = groqCreate.mock.calls[0] as [
      {
        model: string;
        temperature: number;
        messages: { role: string; content: string }[];
        response_format: unknown;
      },
      { maxRetries: number; timeout: number; signal: AbortSignal },
    ];
    expect(body.model).toBe("openai/gpt-oss-20b");
    expect(body.temperature).toBe(0);
    expect(body.response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "intent", strict: true, schema: INTENT_JSON_SCHEMA },
    });
    expect(body.messages.map((m) => m.role)).toEqual(["system", "user"]);
    // The question is data in the user message only.
    expect(body.messages[0]?.content).not.toContain(SECRET_QUERY);
    expect(body.messages[1]?.content).toBe(SECRET_QUERY);
    expect(options.maxRetries).toBe(0);
    expect(options.timeout).toBe(8000);
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(groqCtor).toHaveBeenCalledWith(
      expect.objectContaining({ maxRetries: 0, timeout: 8000 }),
    );
  });

  it("LLM_MODEL overrides the default model", async () => {
    vi.stubEnv("LLM_MODEL", "openai/gpt-oss-120b");
    groqCreate.mockResolvedValue(groqReply(json({ action: "unsupported" })));
    await resolveIntent("x", "es", catalog);
    expect((groqCreate.mock.calls[0] as [{ model: string }])[0].model).toBe(
      "openai/gpt-oss-120b",
    );
  });

  it("accepts a known sub-basin and a search", async () => {
    groqCreate.mockResolvedValueOnce(
      groqReply(
        json({ action: "select_subbasin", slug: "limay", query: null }),
      ),
    );
    expect(await resolveIntent("cuenca del limay", "es", catalog)).toEqual({
      action: "select_subbasin",
      slug: "limay",
    });
    groqCreate.mockResolvedValueOnce(
      groqReply(json({ action: "search", slug: null, query: "Arroyo Foo" })),
    );
    expect(await resolveIntent("arroyo foo", "es", catalog)).toEqual({
      action: "search",
      query: "Arroyo Foo",
    });
  });

  it("turns an invented slug into unsupported", async () => {
    groqCreate.mockResolvedValue(
      groqReply(json({ action: "select_river", slug: "amazon", query: null })),
    );
    expect(await resolveIntent("x", "en", catalog)).toEqual({
      action: "unsupported",
    });
  });

  it("turns invalid JSON, empty and null output into unsupported", async () => {
    for (const content of ["not json", "", null]) {
      groqCreate.mockResolvedValueOnce(groqReply(content));
      expect(await resolveIntent("x", "en", catalog)).toEqual({
        action: "unsupported",
      });
    }
  });

  it("turns an empty choices list into unsupported", async () => {
    groqCreate.mockResolvedValue({ choices: [] });
    expect(await resolveIntent("x", "en", catalog)).toEqual({
      action: "unsupported",
    });
  });

  it("never throws and never logs the question when the provider fails", async () => {
    groqCreate.mockRejectedValue(
      Object.assign(new Error(`bad request: ${SECRET_QUERY}`), {
        status: 429,
      }),
    );
    await expect(resolveIntent(SECRET_QUERY, "en", catalog)).resolves.toEqual({
      action: "unsupported",
    });
    expect(groqCreate).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith("llm failed", 429);
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("zzqx");
  });

  it("is unsupported when the 8 s signal aborts the call", async () => {
    groqCreate.mockImplementation(
      (_body: unknown, options: { signal: AbortSignal }) =>
        new Promise((_, reject) => {
          options.signal.addEventListener("abort", () =>
            reject(options.signal.reason),
          );
        }),
    );
    // AbortSignal.timeout runs on an internal timer fake timers can't reach.
    const controller = new AbortController();
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(controller.signal);
    const pending = resolveIntent(SECRET_QUERY, "en", catalog);
    controller.abort(new DOMException("timed out", "TimeoutError"));
    await expect(pending).resolves.toEqual({ action: "unsupported" });
    expect(timeout).toHaveBeenCalledWith(8000);
    expect(errorSpy).toHaveBeenCalledWith("llm failed", "TimeoutError");
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("zzqx");
  });
});

describe("resolveIntent with gemini", () => {
  beforeEach(() => {
    vi.stubEnv("LLM_PROVIDER", "gemini");
  });

  it("uses generateContent with responseJsonSchema and no retries, once", async () => {
    geminiGenerate.mockResolvedValue({
      text: json({ action: "select_river", slug: "negro", query: null }),
    });
    const intent = await resolveIntent(SECRET_QUERY, "en", catalog);
    expect(intent).toEqual({ action: "select_river", slug: "negro" });
    expect(geminiGenerate).toHaveBeenCalledTimes(1);
    const [req] = geminiGenerate.mock.calls[0] as [
      {
        model: string;
        contents: string;
        config: Record<string, unknown> & { httpOptions: unknown };
      },
    ];
    expect(req.model).toBe("gemini-3.5-flash-lite");
    expect(req.contents).toBe(SECRET_QUERY);
    expect(req.config.responseMimeType).toBe("application/json");
    expect(req.config.responseJsonSchema).toEqual(INTENT_JSON_SCHEMA);
    expect(req.config.abortSignal).toBeInstanceOf(AbortSignal);
    expect(req.config.httpOptions).toEqual({
      timeout: 8000,
      retryOptions: { attempts: 1 },
    });
    expect(geminiCtor).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "gem_test" }),
    );
  });

  it("is unsupported for an invented slug, missing text, or a throw", async () => {
    geminiGenerate.mockResolvedValueOnce({
      text: json({ action: "select_river", slug: "nope", query: null }),
    });
    expect(await resolveIntent("x", "en", catalog)).toEqual({
      action: "unsupported",
    });
    geminiGenerate.mockResolvedValueOnce({ text: undefined });
    expect(await resolveIntent("x", "en", catalog)).toEqual({
      action: "unsupported",
    });
    geminiGenerate.mockRejectedValueOnce(new Error(SECRET_QUERY));
    expect(await resolveIntent(SECRET_QUERY, "en", catalog)).toEqual({
      action: "unsupported",
    });
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("zzqx");
  });
});

describe("resolveIntent without a provider", () => {
  it("is unsupported and makes no call", async () => {
    vi.stubEnv("LLM_PROVIDER", "");
    expect(await resolveIntent("x", "en", catalog)).toEqual({
      action: "unsupported",
    });
    expect(groqCreate).not.toHaveBeenCalled();
    expect(geminiGenerate).not.toHaveBeenCalled();
  });
});
