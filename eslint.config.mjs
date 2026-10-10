import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Server-only modules (LLM, catalog, rate limit) must never reach the client bundle.
  {
    files: ["components/**", "lib/store.ts", "lib/use-*.ts", "app/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/lib/llm",
                "@/lib/llm/*",
                "@/lib/ask/catalog",
                "@/lib/ask/server/*",
                "groq-sdk",
                "@google/genai",
                "@upstash/*",
              ],
              message:
                "Server-only: the LLM, the ask catalog and the rate limiter must not be imported from client code.",
            },
          ],
        },
      ],
    },
  },
  // Turn off stylistic rules that conflict with Prettier (must come last).
  prettier,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "data/**",
    "test-results/**",
    "playwright-report/**",
    "public/maplibre/**",
  ]),
]);

export default eslintConfig;
