import "server-only";
import type { Catalog } from "@/lib/ask/catalog";
import { UNSUPPORTED, validateIntentText, type Intent } from "@/lib/ask/intent";
import type { AskLocale } from "@/lib/ask/query";
import { getLlmEnv } from "@/lib/env";
import { createGeminiProvider } from "@/lib/llm/gemini";
import { createGroqProvider } from "@/lib/llm/groq";
import { buildSystemPrompt } from "@/lib/llm/prompt";
import { LLM_TIMEOUT_MS, type LlmProvider } from "@/lib/llm/provider";

/** The configured provider, or null when LLM_PROVIDER is unset or the env is invalid. */
function getProvider(): LlmProvider | null {
  try {
    const env = getLlmEnv();
    if (env.LLM_PROVIDER === "groq")
      return createGroqProvider(env.GROQ_API_KEY, env.LLM_MODEL);
    if (env.LLM_PROVIDER === "gemini")
      return createGeminiProvider(env.GEMINI_API_KEY, env.LLM_MODEL);
    return null;
  } catch {
    return null;
  }
}

export function isLlmEnabled(): boolean {
  try {
    return getLlmEnv().LLM_PROVIDER !== undefined;
  } catch {
    return false;
  }
}

/**
 * Routes a question to a map action with one provider call: no retries, 8 s timeout.
 * The model only picks an id from the catalog; validateIntentText rejects anything else.
 * Never throws and never logs the question: every failure is `unsupported`.
 */
export async function resolveIntent(
  query: string,
  locale: AskLocale,
  catalog: Catalog,
): Promise<Intent> {
  try {
    const provider = getProvider();
    if (!provider) return UNSUPPORTED;
    const text = await provider.complete(
      buildSystemPrompt(locale, catalog),
      query,
      AbortSignal.timeout(LLM_TIMEOUT_MS),
    );
    return validateIntentText(text, catalog.known, query);
  } catch (error) {
    const reason =
      error instanceof Error
        ? ((error as { status?: unknown }).status ?? error.name)
        : "unknown";
    console.error("llm failed", reason);
    return UNSUPPORTED;
  }
}
