---
name: extract-components
description: Refactor and modularize React/Next.js TypeScript code by extracting reusable components, hooks and utilities. Use when a component is too large, has duplicated JSX or logic, mixes data/state/presentation, or when asked to "refactor", "modularize", "split up", "extract" or "make reusable".
---

# Extract Components

Refactor code into small, reusable, well-named units **without changing behavior**.

## Principles
1. **Behavior-preserving.** A refactor changes structure, never output. No feature changes, no style tweaks, no drive-by fixes (list them separately instead).
2. **Rule of three.** Extract when a pattern appears 3+ times, or when a unit has a clear single responsibility and is hard to read inline. Do not abstract on a single use "just in case".
3. **Smallest safe step.** One extraction at a time; verify after each.
4. **Follow the existing codebase.** Match its folder layout, naming, styling approach (e.g. Tailwind) and state library (e.g. Zustand). Read `CLAUDE.md` / `PLAN.md` first if present.

## Workflow

### 1. Scope and baseline
- Identify the target file(s). Ask only if the target is genuinely ambiguous.
- Run the project checks (`npm run check` or typecheck + lint + tests) and note the baseline. If it already fails, say so before touching anything.
- Never dump huge files into context: read the target and its direct imports only.

### 2. Analyze (read-only)
Look for these smells and list findings briefly before editing:
- **Long components** (>150 lines) or deeply nested JSX
- **Duplicated JSX** or near-duplicates differing by a few props
- **Mixed concerns**: fetching + state + formatting + markup in one component
- **Inline logic** that can be a custom hook (`useX`) or a pure util
- **Repeated types/constants/magic values**
- **Prop drilling** over 2+ levels (consider composition, context or the store)
- **Inline handlers/derived values** repeated across components

### 3. Plan the extractions
Produce a short plan: for each unit, its name, kind, location, and props/signature. Pick the right kind:

| Kind | Use when | Location |
|---|---|---|
| UI component | Repeated or self-contained markup | `components/<domain>/` (or `components/ui/` if generic) |
| Custom hook | Stateful/effectful logic, no markup | `lib/hooks/` or next to the feature |
| Pure util | Formatting, math, mapping, no React | `lib/` (e.g. `units.ts`) |
| Types/constants | Shared shapes and values | `types.ts` / `constants.ts` beside the feature |

For non-trivial refactors (multiple files, API changes), show the plan and get a go-ahead before editing.

### 4. Extract
- **Props:** minimal, typed explicitly (no `any`), prefer primitives or small objects over passing whole entities. Use `children` / slots for composition instead of boolean-flag explosions.
- **Variants over duplication:** if two components differ slightly, one component with a typed `variant`/`size` prop (or `cva`-style map) beats two copies. If variants diverge a lot, keep them separate.
- **Naming:** components in PascalCase by what they *are* (`StatCard`), hooks `useThing`, utils by verb (`formatKm`). One exported component per file; file name = export name.
- **Keep it pure:** presentational components receive data via props; fetching and store access stay in containers/hooks.
- **Next.js App Router:** keep Server Components as the default. Add `"use client"` only to the smallest leaf that needs state/effects/browser APIs; do not push the boundary higher by extraction. Never import server-only code (DB clients, secrets) into client components.
- **i18n:** if the project uses i18n, extracted components must not hardcode user-facing strings. Pass translated text via props or use the translation hook inside; add any new message keys to **all** locale files.
- **Accessibility:** preserve semantic elements, labels, roles and keyboard behavior when moving markup.
- **Styling:** move class strings with the markup; do not restyle. Avoid creating wrapper `div`s that alter layout.
- **Barrel files:** only add an `index.ts` if the codebase already uses them.

### 5. Verify after each step
- Typecheck, lint, tests (`npm run check`).
- Confirm no unused imports/exports and no circular dependencies.
- If UI is involved and screenshot/e2e tests exist, run them; otherwise state that visual parity was not machine-verified.

### 6. Report
Finish with a short summary:
- New files and what each contains
- Files simplified (before → after line counts if useful)
- Behavior changes: should be "none"
- Anything noticed but intentionally left alone (bugs, further candidates)
- Check results

## Anti-patterns (don't)
- Over-abstracting into generic "God components" with 10+ props
- Extracting one-off JSX into a file used once, with no clarity gain
- Changing public props/exports without updating all call sites
- Moving files without updating imports, or leaving dead code behind
- Mixing refactor and feature work in the same change; suggest separate commits
- Inventing behavior or data to make an abstraction fit

## Commit guidance
Small commits, one logical extraction each, e.g. `refactor: extract StatCard from RiverPanel`.
