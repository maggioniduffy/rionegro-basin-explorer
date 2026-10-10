import "server-only";
import { GoogleGenAI } from "@google/genai";
import { INTENT_JSON_SCHEMA } from "@/lib/ask/intent";
import { LLM_TIMEOUT_MS, type LlmProvider } from "./provider";

export const GEMINI_DEFAULT_MODEL = "gemini-3.5-flash-lite";

export function createGeminiProvider(
  apiKey: string,
  model: string = GEMINI_DEFAULT_MODEL,
): LlmProvider {
  // attempts: 1 means no retries (HttpRetryOptions: "If 0 or 1, it means no retries").
  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: { timeout: LLM_TIMEOUT_MS, retryOptions: { attempts: 1 } },
  });
  return {
    async complete(system, user, signal) {
      const response = await ai.models.generateContent({
        model,
        contents: user,
        config: {
          systemInstruction: system,
          temperature: 0,
          responseMimeType: "application/json",
          responseJsonSchema: INTENT_JSON_SCHEMA,
          abortSignal: signal,
          httpOptions: {
            timeout: LLM_TIMEOUT_MS,
            retryOptions: { attempts: 1 },
          },
        },
      });
      return response.text ?? "";
    },
  };
}
