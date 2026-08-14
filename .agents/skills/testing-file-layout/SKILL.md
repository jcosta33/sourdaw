---
name: testing-file-layout
description: >-
  Place every Vitest spec in a `__tests__/` directory inside the folder that owns
  the code under test, and reproduce a defect with a failing test before touching
  behaviour. ALWAYS apply when creating a `*.spec.ts` / `*.spec.tsx` file, moving
  or renaming a spec, or reviewing a diff that adds or relocates tests — even if
  it looks like a one-line rename. Skip writing production code, configuring the
  test runner, or authoring docs.
---

## Purpose

Specs live in `__tests__/` directories, never beside the source. Layout drift — co-located specs, barrels inside `__tests__/`, shared helpers dumped next to one-off tests — makes suites hard to find and move.

## Core rules

### 1. Specs live in `__tests__/` inside the owning folder

For `path/to/SourceFile.ts`, the spec is `path/to/__tests__/SourceFile.spec.ts` (same basename; `.spec.tsx` for components).

```text
src/modules/Arrangement/useCases/addTrack.ts
src/modules/Arrangement/useCases/__tests__/addTrack.spec.ts
```

**Why:** specs next to their concept folder stay discoverable and move with refactors; co-location beside the source fights the project convention.

### 2. Reproduce before you fix

For behaviour changes and bug fixes: write or update a failing test first, see red, then fix, then see green. Paste both outputs.

**Why:** a fix without a red reproduction is a claim, not proof.

### 3. Import the subject one level up

From `useCases/__tests__/addTrack.spec.ts`:

```typescript
import { addTrack } from '../addTrack';
```

Cross-module imports still go through contract barrels — not private `models/` or deep use-case paths. The test cruise covers module tests, tests outside `src/modules`, and `src/setupTests.ts`.

**Why:** sibling-relative imports keep the subject local; foreign deep imports are the same architecture violation production code has.

### 4. Put shared helpers in their canonical folder

Module-scoped dummies/fixtures that are not a single-spec detail live where the module already keeps test support (e.g. module `__tests__/` helpers). DI/event test helpers live under the infra `testing/` folders (`src/infra/*/testing/`), not scattered as one-off copies. No `index.ts` barrel inside `__tests__/`.

**Why:** barrels and misplaced helpers become a second private API nobody owns.

### 5. Prefer the DI seam over `vi.mock` for injectables

When the subject is built with the project’s inject/container pattern, swap dependencies via the test inject seam. Reserve `vi.mock` for true module-level externals.

**Why:** hoisted mocks make specs order-dependent and hide the real seam.

### 6. Hard gate: run the targeted spec and see it pass

```bash
pnpm test:run path/to/__tests__/file.spec.ts
```

Run the affected file. Never expand to the full suite.

**Why:** an unrun test is not a test.

## What does not belong

- Production-code changes solely to make a bad test pass (fix the test or surface the bug).
- E2E / browser automation (different harness).

## References

- [docs/06-testing.md](../../../docs/06-testing.md) — Vitest layout, mocks, DI in tests.
- `.dependency-cruiser.tests.cjs` — test-inclusive barrel rules, ratcheted by `scripts/check-dependency-boundaries.mjs`.
