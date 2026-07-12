---
name: testing-file-layout
type: agent-guide
description: >-
  Place every Vitest spec in a `__tests__/` directory inside the folder that owns
  the code under test, and reproduce a defect with a failing test before touching
  behaviour. ALWAYS apply this skill when creating a `*.spec.ts` / `*.spec.tsx`
  file, moving or renaming a spec, or reviewing a diff that adds or relocates
  tests — even if it looks like a one-line rename. Do not co-locate a spec beside
  its source, add a barrel `index.ts` inside `__tests__/`, or fix a bug before a
  failing reproduction exists. Skip this skill for writing production code,
  configuring the test runner, or authoring docs.
---

# Skill: Testing file layout

## Purpose

Specs in this repo live in `__tests__/` directories, never beside the source.
When a spec drifts from that layout — co-located next to the source, dropped in
the wrong shared folder, or fronted by a barrel `index.ts` — Knip mis-classifies
files, imports break on the next move, and the layer-by-layer testing doc stops
matching reality. This skill keeps every spec in its canonical home and forces a
failing reproduction before any behaviour change, so fixes are grounded in the
real execution path rather than a static guess.

## Core rules

### 1. Specs live in `__tests__/` inside the owning folder

All Vitest specs live in a **`__tests__/`** directory **inside** the folder that
owns the code under test — never beside the source file.

| Production file                    | Spec                                                                                                             |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `useCases/addTrack.ts`             | `useCases/__tests__/addTrack.spec.ts`                                                                            |
| `repositories/foo.ts`              | `repositories/__tests__/foo.spec.ts`                                                                             |
| `presentations/views/ClipView.tsx` | `presentations/views/__tests__/ClipView.spec.tsx` (or a subfolder's `__tests__/` if the concept is scoped there) |

_Why: a single canonical home keeps the source folder free of test noise, lets
Knip exclude specs by one glob (rule 6), and means the move of a source file and
its spec stay one directory apart forever._

### 2. Reproduce before you fix (empirical proof)

Before fixing a bug or modifying application behavior, you MUST write a failing
test or a reproduction script first. If you cannot empirically prove the bug
exists or the behavior is missing in a vacuum, you are not allowed to fix it.

_Why: this forces you to understand the actual execution path rather than guessing
based on static code reading; a fix without a red-first test cannot be shown to
address the real defect._

### 3. Import the subject one level up

From `path/to/__tests__/foo.spec.ts`, import the subject with **`../foo`** (one
level up to the sibling source file). Adjust `../` depth for nested folders.

_Why: the spec sits exactly one directory below its source, so the relative path
is predictable; getting the depth wrong is the most common breakage when a spec
is moved into or out of a nested concept folder._

### 4. Put shared helpers in their canonical folder

- **Module-wide** dummies and mocks: `src/modules/<Module>/__tests__/` (module root).
- **Cross-module** helpers: `src/helpers/__tests__/`.
- **DI / event helpers** (not specs): `src/infra/di/testing/`, `src/infra/events/testing/`.

_Why: scope dictates location — a helper placed too narrowly gets duplicated,
placed too broadly it leaks into modules that should not depend on it. DI/event
helpers are production-adjacent fixtures, not specs, so they live under `testing/`
rather than `__tests__/`._

### 5. Read the authoritative testing doc first

`docs/06-testing.md` — philosophy, layer-by-layer examples, mocks, anti-patterns.
Read it before writing or moving tests.

_Why: this skill is the layout contract; the doc carries the per-layer detail
(use cases, repositories, transformers, stores, hooks, components, engine, Rust).
The skill keeps you in the right files; the doc keeps the tests themselves right._

### 6. Keep the tooling assumptions intact

- **Knip** excludes `**/*.spec.{ts,tsx}` from the project graph (`knip.json`) so
  specs are not treated as unused modules.
- Run a **single-file** Vitest pass: `pnpm exec vitest run path/to/__tests__/foo.spec.ts`
  (never claim green from watch mode or an unrun suite).

**Why:** Knip's exclusion glob only works while every spec matches the `*.spec.*`
naming. A test that was never run is a claim, not a test.

### 7. Prefer the DI seam over `vi.mock` for injectables

Use cases and repositories wrapped with `inject` from `#/infra/di/inject` should be
stubbed with `injectDependencies` from `#/infra/di/testing/injectDependencies` when
you need a collaborator swapped.

```typescript
import { injectDependencies } from '#/infra/di/testing/injectDependencies';

injectDependencies(getProduct, { getProductApi: vi.fn().mockResolvedValue(product) });
```

**Why:** `vi.mock` hijacks the module graph; the DI seam exercises the same resolution
path production uses. See `docs/06-testing.md`.

## What does not belong

- **Production code, runner configuration, and per-layer test patterns** belong
  elsewhere: feature code is out of scope; `vitest`/`knip` config is the runner's
  own concern; how to test each layer lives in `docs/06-testing.md`, not here.
- **DI / event helpers** are not specs — they belong under `src/infra/di/testing/`
  and `src/infra/events/testing/`, not in a `__tests__/` directory.
- **Barrel `index.ts` files** never belong inside `__tests__/` (see `docs/06-testing.md` §10).

## Anti-patterns

### CRITICAL — Fix without a red reproduction

❌ Change production code from a static read alone  
✅ Failing test or script first; paste red-then-green output

### CRITICAL — Claim green without running the file

❌ “Should pass” / watch-mode glance  
✅ `pnpm exec vitest run <that-spec>` and paste the summary

### HIGH — Spec co-located beside source

❌ `useCases/addTrack.spec.ts` next to `addTrack.ts`  
✅ `useCases/__tests__/addTrack.spec.ts` with `import { addTrack } from '../addTrack'`

### HIGH — Barrel inside `__tests__/`

❌ `__tests__/index.ts` re-exporting specs  
✅ Flat `__tests__/` folders only

### MEDIUM — `vi.mock` for an injectable collaborator

❌ Module-graph mock of a repository used only through `inject`  
✅ `injectDependencies(useCase, { repo: vi.fn() })` when the subject is injectable

## Self-review gate

Run this before declaring any spec add/move/review complete. Not complete until
each item below has a written, output-backed answer in the self-review trace.

1. **Layout** — every new or moved spec sits in a `__tests__/` directory inside
   its owning folder, not beside the source. Paste the spec's path.
2. **Import** — each spec imports its subject via the correct `../` depth. Paste
   the spec's import line(s).
3. **Shared helpers** — any new dummy/mock/helper lives in its canonical folder
   for its scope; DI/event helpers are under `testing/`, not `__tests__/`. Paste
   the path of any helper added or moved (or write "none added").
4. **No barrels** — no `index.ts` was added inside any `__tests__/` directory.
   Paste the output of a check, e.g. `find . -path '*/__tests__/index.ts'`
   (empty result = pass).
5. **Reproduction-first** — for any behaviour change, the failing-then-passing
   transition is pasted. Not complete until the red-before / green-after output
   appears verbatim.
6. **Single-file run** — the affected spec passes on its own. Not complete until
   the `pnpm exec vitest run <path-to-spec>` output appears verbatim, last two lines minimum.
7. **Boundaries / types** — for any moved import paths, `pnpm deps:validate` and
   `pnpm typecheck` pass. Not complete until their output appears verbatim.
