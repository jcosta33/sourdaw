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

Specs live in `__tests__/` directories, never beside the source. Co-located specs, barrels inside `__tests__/`, and shared helpers dumped next to one-off tests make suites hard to find and move. E2E and browser automation are a different harness.

## Rules

### 1. Specs live in `__tests__/` inside the owning folder

For a single `path/to/SourceFile.ts` subject, default to `path/to/__tests__/SourceFile.spec.ts` — same basename, `.spec.tsx` for components. A behavior spanning several subjects may have a behavior-named integration spec in the owning folder's `__tests__/`.

**Why:** specs next to their concept folder stay discoverable and move with refactors; co-location beside the source fights the project convention.

**Enforced by:** review only.

### 2. Reproduce before you fix

For behaviour changes and bug fixes: write or update a failing test first, see red, then fix, then see green. Paste both outputs. Never change production code solely to make a bad test pass — fix the test or surface the bug.

**Why:** a fix without a red reproduction is a claim, not proof.

**Enforced by:** review only.

### 3. Import the subject one level up

From `useCases/__tests__/addTrack.spec.ts`, import `../addTrack`. For a multi-subject spec, import local subjects relatively and foreign modules through contract barrels — not private `models/` or deep use-case paths. Test seams may double external systems while retaining real collaborators needed for the asserted behavior; see `docs/06-testing.md`.

**Why:** a foreign deep import is the same architecture violation in a test that it is in production code.

**Enforced by:** dependency-cruiser `external-tests-contract-only` and `external-tests-no-relative-module-imports` (`.dependency-cruiser.tests.cjs`).

### 4. Put shared helpers in their canonical folder

Module-scoped dummies and fixtures that are not a single-spec detail live where the module already keeps test support (e.g. module `__tests__/` helpers). DI/event test helpers live under the infra `testing/` folders (`src/infra/*/testing/`), never scattered as one-off copies. No `index.ts` barrel inside `__tests__/`.

**Why:** barrels and misplaced helpers become a second private API nobody owns.

**Enforced by:** review only.

### 5. Prefer the DI seam over `vi.mock` for injectables

When the subject is built with the project’s inject/container pattern, swap dependencies through the test inject seam. Reserve `vi.mock` for true module-level externals.

**Why:** hoisted mocks make specs order-dependent and hide the real seam.

**Enforced by:** review only.

### 6. Hard gate: run the targeted spec and see it pass

```bash
pnpm guard --profile focused -- pnpm test:run path/to/__tests__/file.spec.ts
```

**Why:** an unrun test is not a test.

**Enforced by:** `scripts/runVitestZeroTestGuard.ts` fails a run that collects no case or executes no assertion.

## References

- [docs/06-testing.md](../../../docs/06-testing.md) — Vitest layout, mocks, DI in tests.
- `.dependency-cruiser.tests.cjs` — test-inclusive barrel rules, ratcheted by `scripts/check-dependency-boundaries.mjs`.
- Assertion rules for MIDI note correlation, grouped inverse replay, and recording admission moved to `../test-design/SKILL.md` rules 11-13.
