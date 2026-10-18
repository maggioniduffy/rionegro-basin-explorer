<!-- Phase file. Index and status: [PLAN.md](../PLAN.md). -->

# Phase 7 — Extras

- [~] **Ask box (EN/ES):** a typed question resolves to a map action (select a river or sub-basin, or search). Fuzzy name match first (Fuse.js over an in-memory catalog, no LLM); otherwise one LLM call (Groq by default, `lib/llm.ts`) that may only return a catalog id, validated with Zod. `/api/ask` with a two-tier cache and a per-IP rate limit (Upstash Redis free tier). one bar for names and questions; comparisons, rankings and single values answered in a card under the bar from Mongo values (v2, 2026-10-10)
  - Code, tests and docs done (2026-10-10): 305 unit/route tests and `e2e/ask.spec.ts` (3 tests, fuzzy path) pass. Left for the owner: create the Upstash database and Groq key (check Upstash overage terms, Groq's training clause and free limits, turn on Zero Data Retention), set the env on Vercel, and try a few sentence questions live
  - **Done when:** fuzzy search resolves typo/accent variants without calling the LLM; sentence-style queries ("show me the biggest tributary of the Limay") resolve to a valid slug or `unsupported`; an invented slug from the LLM can never reach the client; rate limit and cache verified by tests; `npm run check` and `npm run test:e2e` pass; all new strings exist in both locales.

Ask box: [DECISSIONS.md](../DECISSIONS.md#phase-7-ask-box-2026-10-10).
