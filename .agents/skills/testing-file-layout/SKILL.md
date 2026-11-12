---
name: testing-file-layout
description: >-
    Place every Vitest spec and test helper in its canonical folder under its
    canonical name, pick the right mock seam (DI injection or `vi.mock`), and
    reproduce a defect with a failing test before touching behaviour. ALWAYS apply
    when creating, moving, or renaming a `*.spec.ts` / `*.spec.tsx` file or a shared
    test helper, choosing how a spec mocks a dependency, or reviewing a diff that
    adds or relocates tests — even if it looks like a one-line rename. Skip what a
    case asserts, its fixtures and its waits (test-design), writing production code,
    configuring the test runner, and authoring docs.
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

**Enforced by:** dependency-cruiser (`.dependency-cruiser.tests.cjs`): `cross-module-index-only` and `no-relative-cross-module-imports` for specs inside `src/modules`; `external-tests-contract-only` and `external-tests-no-relative-module-imports` for specs outside `src/modules`.

### 4. Put shared helpers in their canonical folder

Module-wide dummies, fixtures, and module-local mocks that are not a single-spec detail live in `src/modules/<Module>/__tests__/` at the module root and are imported relatively from deeper specs. Test utilities shared across modules (a mock `AudioContext`, shared helpers) live in `src/helpers/__tests__/`. DI and event runtime test helpers live in `src/infra/di/testing/` and `src/infra/events/testing/`. Never scatter one-off copies. No `index.ts` barrel inside `__tests__/`.

**Why:** barrels and misplaced helpers become a second private API nobody owns.

**Enforced by:** review only.

### 5. Pick the mock seam by how the dependency is wired

- An injectable (a function wrapped in `inject()`): double its dependencies with `spy<T>()` and `injectDependencies()` from `src/infra/di/testing/`.
- A module outside the inject map (for example `#/utils/desktopBridge`), or a thin static same-module repository an injectable uses that is not in the inject map: `vi.mock` that module.
- Never mix `vi.mock` and `injectDependencies()` for the same dependency; pick one.
- Mocking another module's contract barrel (`useCases`, `stores`, `events`, `presentations/views`) is sanctioned in two shapes only: a factory naming every export the spec's module graph imports from that barrel, or a factory that spreads `await importOriginal()` first and overrides only the stubs. The spread is faithful by default but loads the real module graph, so measure it on a heavy barrel. A hand-listed factory that misses a name goes stale the moment the barrel grows: the missing export resolves to `undefined` and can redden every test in the file.

**Why:** the DI seam is the one the code actually exposes, so a hoisted `vi.mock` over an injectable hides it and makes the spec order-dependent; a stale barrel factory breaks specs in modules the author never touched.

**Enforced by:** `pnpm test:barrel-mocks` (PR CI) for contract-barrel factory coverage; `injectDependencies()` throws when a declared dependency is missing from its mocks; seam choice is review only. Detail: `docs/06-testing.md` "When to use which" and "Mocking a contract barrel".

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
