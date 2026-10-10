import "server-only";
import Groq from "groq-sdk";
import { INTENT_JSON_SCHEMA } from "@/lib/ask/intent";
import { LLM_TIMEOUT_MS, type LlmProvider } from "./provider";

/** Strict structured output is only available on some models (gpt-oss-20b/120b, qwen3.8-27b). */
export const GROQ_DEFAULT_MODEL = "openai/gpt-oss-20b";

export function createGroqProvider(
  apiKey: string,
  model: string = GROQ_DEFAULT_MODEL,
): LlmProvider {
  // maxRetries: 0 so one question is one provider call (the quota is the budget).
  const client = new Groq({
    apiKey,
    maxRetries: 0,
    timeout: LLM_TIMEOUT_MS,
  });
  return {
    async complete(system, user, signal) {
      const completion = await client.chat.completions.create(
        {
          model,
          temperature: 0,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "intent",
              strict: true,
              schema: INTENT_JSON_SCHEMA,
            },
          },
        },
        { signal, maxRetries: 0, timeout: LLM_TIMEOUT_MS },
      );
      return completion.choices[0]?.message.content ?? "";
    },
  };
}
