---
name: testing-file-layout
description: Apply when creating, moving, or reviewing Vitest spec files (*.spec.ts, *.spec.tsx) and test file paths in this repo.
---

# Testing file layout

## Rule

All Vitest specs live in **`__tests__/`** directories **inside** the folder that owns the code under test — never beside the source file.

| Production file | Spec |
| ----------------- | ---------------------------------------- |
| `useCases/addTrack.ts` | `useCases/__tests__/addTrack.spec.ts` |
| `repositories/foo.ts` | `repositories/__tests__/foo.spec.ts` |
| `presentations/views/ClipView.tsx` | `presentations/views/__tests__/ClipView.spec.tsx` (or a subfolder’s `__tests__/` if the concept is scoped there) |

## Reproduction First (Empirical Proof)

Before fixing a bug or modifying application behavior, you MUST write a failing test or a reproduction script first. If you cannot empirically prove the bug exists or the behavior is missing in a vacuum, you are not allowed to fix it. This forces you to understand the actual execution path rather than guessing based on static code reading.

## Imports

From `path/to/__tests__/foo.spec.ts`, import the subject with **`../foo`** (one level up to the sibling source file). Adjust `../` depth for nested folders.

## Shared utilities

- **Module-wide** dummies and mocks: `src/modules/<Module>/__tests__/` (module root).
- **Cross-module** helpers: `src/helpers/__tests__/`.
- **DI / event helpers** (not specs): `src/infra/di/testing/`, `src/infra/events/testing/`.

## Authoritative doc

`docs/06-testing.md` — philosophy, layer-by-layer examples, mocks, anti-patterns. Read it before writing or moving tests.

## Tooling

- **Knip** excludes `**/*.spec.{ts,tsx}` from the project graph (`knip.json`) so specs are not treated as unused modules.
- Run `pnpm test:run <path-to-spec>` for a single file.

## Anti-patterns

- Placing `*.spec.ts` next to `addTrack.ts` in `useCases/` (old co-location).
- Adding `index.ts` barrel files inside `__tests__/` (see `docs/06-testing.md` §10).
