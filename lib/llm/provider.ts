import "server-only";

/** One structured-output completion; implementations make exactly one request. */
export interface LlmProvider {
  complete(system: string, user: string, signal: AbortSignal): Promise<string>;
}

/** Longest the ask box waits for a provider. */
export const LLM_TIMEOUT_MS = 8000;
