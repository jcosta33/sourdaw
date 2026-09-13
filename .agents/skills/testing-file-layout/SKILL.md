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

## Core rules

### 1. Specs live in `__tests__/` inside the owning folder

For `path/to/SourceFile.ts`, the spec is `path/to/__tests__/SourceFile.spec.ts` — same basename, `.spec.tsx` for components. Specs next to their concept folder stay discoverable and move with refactors; co-location beside the source fights the project convention.

### 2. Reproduce before you fix

For behaviour changes and bug fixes: write or update a failing test first, see red, then fix, then see green. Paste both outputs. A fix without a red reproduction is a claim, not proof. Never change production code solely to make a bad test pass — fix the test or surface the bug.

### 3. Import the subject one level up

From `useCases/__tests__/addTrack.spec.ts`, import `../addTrack`. Cross-module imports still go through contract barrels — not private `models/` or deep use-case paths. Sibling-relative imports keep the subject local; a foreign deep import is the same architecture violation in a test that it is in production code.

### 4. Put shared helpers in their canonical folder

Module-scoped dummies and fixtures that are not a single-spec detail live where the module already keeps test support (e.g. module `__tests__/` helpers). DI/event test helpers live under the infra `testing/` folders (`src/infra/*/testing/`), never scattered as one-off copies. No `index.ts` barrel inside `__tests__/`: barrels and misplaced helpers become a second private API nobody owns.

### 5. Prefer the DI seam over `vi.mock` for injectables

When the subject is built with the project’s inject/container pattern, swap dependencies through the test inject seam. Reserve `vi.mock` for true module-level externals; hoisted mocks make specs order-dependent and hide the real seam.

### 6. Hard gate: run the targeted spec and see it pass

```bash
pnpm test:run path/to/__tests__/file.spec.ts
```

An unrun test is not a test.

### 7. MIDI note-correlation regressions prove the rack boundary

When a MIDI transform or filter stores a Note On decision for a later Note Off,
test supplied `noteInstanceId` values through `MidiRack`. Attack one equal-pitch
note, change the deciding parameter while it remains held, then attack and
release a second identity before the first. Assert the emitted identity and
transformed pitch or suppression, and make the fixture fail if instance
correlation is replaced by channel/pitch FIFO. Keep identityless FIFO coverage
separate.

### 8. Prefix-dependent inverses need real grouped replay

PR #4071's forward comp-then-remove case proved that the removed lane stayed absent, but it did not inspect the
removal inverse's intermediate snapshot or run grouped undo and redo. When one batch member snapshots state produced
by an earlier member, inspect the real history entry and replay the group against both raw CRDT authority and its store
projection; a correct forward final state alone cannot prove the inverse was composed from the batch prefix.

### 9. Worker-ready recording admission needs the real first-frame seam

Commit `c9fd03bfb9b13d939c20998ff6b3307fc7b5d755` made recording capture start from a worker-ready
continuation while the command still returned success before the worklet captured input. For any recording-admission
change, hold worker readiness through the real recorder-to-transport route and drive the first nonempty processor block
at a known `AudioWorkletGlobalScope.currentFrame`. Prove that no successful-start observable or uncaptured transport
interval exists before the actual sample-zero receipt, then prove exactly one start after it. A returned boolean, worker
ready message, main-thread callback time, or pre-resolved recorder mock cannot establish capture-clock alignment.

## References

- [docs/06-testing.md](../../../docs/06-testing.md) — Vitest layout, mocks, DI in tests.
- `.dependency-cruiser.tests.cjs` — test-inclusive barrel rules, ratcheted by `scripts/check-dependency-boundaries.mjs`.
